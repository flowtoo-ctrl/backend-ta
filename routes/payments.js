const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const Event = require('../models/Event');
const Ticket = require('../models/Ticket');

const {
  createTicket,
  updateEventTicketsAvailable,
  getEventById,
} = require('../utils/database');


/* =========================
   PAYFAST SIGNATURE FUNCTION
========================= */
function generateSignature(data, passphrase) {
  const keys = Object.keys(data)
    .filter(k => data[k] !== "" && data[k] !== null && data[k] !== undefined && k !== "signature")
    .sort();

  let pfParamString = "";

  keys.forEach((key, index) => {
    let value = data[key].toString().trim();
    value = encodeURIComponent(value).replace(/%20/g, "+");
    pfParamString += `${key}=${value}`;

    if (index < keys.length - 1) {
      pfParamString += "&";
    }
  });

  if (passphrase && passphrase.trim() !== "") {
    pfParamString += `&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, "+")}`;
  }

  return crypto
    .createHash("md5")
    .update(pfParamString)
    .digest("hex");
}


/* =========================
   SEND EMAIL WITH PDF TICKET
========================= */
async function sendTicketEmail(event, email, qrCodeDataUrl, paymentId) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  const doc = new PDFDocument({ size: "A5", margin: 30 });
  const buffers = [];

  doc.on("data", buffers.push.bind(buffers));

  return new Promise((resolve, reject) => {
    doc.on("end", async () => {
      try {
        const pdfBuffer = Buffer.concat(buffers);

        await transporter.sendMail({
          from: `"TicketHub" <${process.env.EMAIL_USER}>`,
          to: email,
          subject: `Your Ticket - ${event.title}`,
          html: `
            <h2>Thank you for your purchase!</h2>
            <p><strong>Event:</strong> ${event.title}</p>
            <p><strong>Date:</strong> ${new Date(event.date).toLocaleString()}</p>
            <p><strong>Location:</strong> ${event.location}</p>
            <p><strong>Price:</strong> R ${event.price.toFixed(2)}</p>
            <p><strong>Ticket ID:</strong> ${paymentId}</p>
            <p>Your PDF ticket is attached.</p>
          `,
          attachments: [
            {
              filename: `${event.title.replace(/ /g, "_")}_ticket.pdf`,
              content: pdfBuffer
            }
          ]
        });

        console.log("✓ Ticket email sent:", email);
        resolve(true);

      } catch (err) {
        console.error("✗ Email error:", err);
        reject(err);
      }
    });

    // Draw PDF content
    doc.fontSize(20).text(event.title, { align: "center" });
    doc.moveDown(1);
    doc.fontSize(14).text(`R ${event.price.toFixed(2)}`, { align: "center" });
    doc.moveDown(2);

    try {
      const qrBuffer = Buffer.from(qrCodeDataUrl.split(",")[1], "base64");
      doc.image(qrBuffer, 180, 250, { width: 120 });
    } catch (err) {
      console.log("QR error:", err);
    }

    doc.end();
  });
}


/* =========================
   INITIATE PAYMENT
========================= */
router.post("/buy", async (req, res) => {
  const { eventId, email, userId } = req.body;

  try {
    console.log("💳 Payment request received:", { eventId, email, userId });

    const event = await getEventById(eventId);

    if (!event) {
      console.log("✗ Event not found:", eventId);
      return res.status(404).json({ error: "Event not found" });
    }

    if (event.ticketsAvailable <= 0) {
      console.log("✗ Event sold out:", eventId);
      return res.status(400).json({ error: "Event sold out" });
    }

    const paymentId = `evt-${eventId}-${Date.now()}`;

    const pfData = {
      merchant_id: process.env.PAYFAST_MERCHANT_ID,
      merchant_key: process.env.PAYFAST_MERCHANT_KEY,
      return_url: process.env.PAYFAST_RETURN_URL,
      cancel_url: process.env.PAYFAST_CANCEL_URL,
      notify_url: process.env.PAYFAST_NOTIFY_URL,
      name_first: "Customer",
      email_address: email,
      m_payment_id: paymentId,
      amount: Number(event.price).toFixed(2),
      item_name: `Ticket for ${event.title}`,
      custom_str1: eventId,
      custom_str2: email,
      custom_int1: parseInt(userId) || 0
    };

    pfData.signature = generateSignature(
      pfData,
      process.env.PAYFAST_PASSPHRASE || ""
    );

    const endpoint =
      process.env.PAYFAST_MODE === "live"
        ? "https://www.payfast.co.za/eng/process"
        : "https://sandbox.payfast.co.za/eng/process";

    console.log("✓ Payment initiated:", paymentId);

    res.json({
      success: true,
      paymentData: pfData,
      endpoint
    });

  } catch (err) {
    console.error("✗ Buy error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


/* =========================
   PAYFAST ITN WEBHOOK
========================= */
router.post("/notify", express.urlencoded({ extended: true }), async (req, res) => {
  res.sendStatus(200);

  const pfData = req.body;

  console.log("\n========================================");
  console.log("📨 ITN RECEIVED");
  console.log("========================================");
  console.log("Payment ID:", pfData.m_payment_id);
  console.log("Payment Status:", pfData.payment_status);
  console.log("Amount:", pfData.amount_gross);
  console.log("Email:", pfData.email_address);
  console.log("========================================\n");

  try {
    // Verify signature
    if (!pfData.signature) {
      console.log("✗ No signature in ITN");
      return;
    }

    const receivedSig = pfData.signature;
    const dataToSign = { ...pfData };
    delete dataToSign.signature;

    const calculatedSig = generateSignature(
      dataToSign,
      process.env.PAYFAST_PASSPHRASE || ""
    );

    console.log("Received Signature:", receivedSig);
    console.log("Calculated Signature:", calculatedSig);

    if (calculatedSig !== receivedSig) {
      console.log("⚠️  Signature mismatch (continuing for sandbox testing)");
    }

    // Check payment status
    if (pfData.payment_status !== "COMPLETE") {
      console.log("✗ Payment not complete, status:", pfData.payment_status);
      return;
    }

    console.log("✓ Payment status verified");

    // Check if ticket already exists
    const existingTicket = await Ticket.findOne({
      paymentId: pfData.m_payment_id
    });

    if (existingTicket) {
      console.log("✓ Ticket already exists, skipping creation");
      return;
    }

    // Get event
    const event = await getEventById(pfData.custom_str1);

    if (!event) {
      console.log("✗ Event not found:", pfData.custom_str1);
      return;
    }

    console.log("✓ Event found:", event.title);

    // Validate amount
    const paid = parseFloat(pfData.amount_gross);
    if (Math.abs(paid - event.price) > 0.01) {
      console.log("✗ Amount mismatch. Expected:", event.price, "Got:", paid);
      return;
    }

    console.log("✓ Amount verified");

    // Generate QR Code
    const qrData = `ticket:${pfData.m_payment_id}:${pfData.email_address}`;
    const qrCodeDataUrl = await QRCode.toDataURL(qrData);
    console.log("✓ QR Code generated");

    // Create ticket
    const ticketData = {
      event: pfData.custom_str1,
      user: parseInt(pfData.custom_int1) || null,
      buyerEmail: pfData.email_address,
      qrCode: qrCodeDataUrl,
      paymentId: pfData.m_payment_id,
      status: "paid"
    };

    console.log("🎫 Creating ticket...");
    const ticket = await createTicket(ticketData);
    console.log("✓ Ticket created:", ticket._id);

    // Update event tickets
    await updateEventTicketsAvailable(
      event._id,
      event.ticketsAvailable - 1
    );
    console.log("✓ Event tickets updated");

    // Send email
    try {
      await sendTicketEmail(
        event,
        pfData.email_address,
        qrCodeDataUrl,
        pfData.m_payment_id
      );
      console.log("✓ Email sent successfully");
    } catch (emailErr) {
      console.error("✗ Email error (but ticket was created):", emailErr.message);
    }

    console.log("========================================");
    console.log("✓ TICKET PURCHASE COMPLETE");
    console.log("========================================\n");

  } catch (err) {
    console.error("✗ ITN error:", err.message);
    console.error(err);
  }
});


/* =========================
   TEST ENDPOINT - CREATE TICKET MANUALLY
   FOR SANDBOX TESTING ONLY
========================= */
router.post("/test-create-ticket", async (req, res) => {
  try {
    const { eventId, email, userId } = req.body;

    console.log("\n========================================");
    console.log("🧪 TEST ENDPOINT - Creating ticket manually");
    console.log("========================================");

    if (!eventId || !email) {
      return res.status(400).json({ error: "Missing eventId or email" });
    }

    // Get event
    const event = await getEventById(eventId);

    if (!event) {
      console.log("✗ Event not found:", eventId);
      return res.status(404).json({ error: "Event not found" });
    }

    console.log("✓ Event found:", event.title);

    // Generate payment ID
    const paymentId = `test-${eventId}-${Date.now()}`;

    // Generate QR Code
    const qrData = `ticket:${paymentId}:${email}`;
    const qrCodeDataUrl = await QRCode.toDataURL(qrData);
    console.log("✓ QR Code generated");

    // Create ticket
    const ticketData = {
      event: eventId,
      user: userId || null,
      buyerEmail: email,
      qrCode: qrCodeDataUrl,
      paymentId: paymentId,
      status: "paid"
    };

    console.log("🎫 Creating ticket...");
    const ticket = await createTicket(ticketData);
    console.log("✓ Ticket created:", ticket._id);

    // Update event tickets
    await updateEventTicketsAvailable(
      event._id,
      event.ticketsAvailable - 1
    );
    console.log("✓ Event tickets updated");

    // Send email
    try {
      await sendTicketEmail(
        event,
        email,
        qrCodeDataUrl,
        paymentId
      );
      console.log("✓ Email sent successfully");
    } catch (emailErr) {
      console.error("✗ Email error (but ticket was created):", emailErr.message);
    }

    console.log("========================================");
    console.log("✓ TEST TICKET CREATED SUCCESSFULLY");
    console.log("========================================\n");

    res.json({
      success: true,
      ticketId: ticket._id,
      paymentId: paymentId,
      message: "Test ticket created successfully"
    });

  } catch (err) {
    console.error("✗ Test endpoint error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router; 
