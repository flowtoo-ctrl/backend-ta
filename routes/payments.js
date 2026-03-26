const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const Event = require('../models/Event');
const Ticket = require('../models/Ticket');

/* =========================
   CONFIG
========================= */
const PAYFAST_HOST =
  process.env.PAYFAST_MODE === "live"
    ? "https://www.payfast.co.za"
    : "https://sandbox.payfast.co.za";


/* =========================
   SIGNATURE (FIXED)
========================= */
function generateSignature(data, passphrase = "") {
  const filtered = {};

  Object.keys(data).forEach(key => {
    if (
      data[key] !== null &&
      data[key] !== undefined &&
      data[key] !== "" &&
      key !== "signature"
    ) {
      filtered[key] = data[key];
    }
  });

  const sortedKeys = Object.keys(filtered).sort();

  let queryString = sortedKeys
    .map(key => {
      return `${key}=${encodeURIComponent(filtered[key]).replace(/%20/g, "+")}`;
    })
    .join("&");

  if (passphrase) {
    queryString += `&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}`;
  }

  console.log("🔐 SIGN STRING:", queryString);

  return crypto.createHash("md5").update(queryString).digest("hex");
}


/* =========================
   VERIFY PAYFAST
========================= */
async function verifyWithPayFast(pfData) {
  try {
    const response = await axios.post(
      `${PAYFAST_HOST}/eng/query/validate`,
      pfData,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }
    );

    return response.data === "VALID";
  } catch (err) {
    console.error("❌ PayFast validation error:", err.message);
    return false;
  }
}


/* =========================
   EMAIL + PDF
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
            <h2>🎟️ Ticket Confirmation</h2>
            <p><strong>Event:</strong> ${event.title}</p>
            <p><strong>Date:</strong> ${new Date(event.date).toLocaleString()}</p>
            <p><strong>Location:</strong> ${event.location}</p>
            <p><strong>Ticket ID:</strong> ${paymentId}</p>
          `,
          attachments: [
            {
              filename: `${event.title}.pdf`,
              content: pdfBuffer
            }
          ]
        });

        resolve();
      } catch (err) {
        console.error("❌ Email error:", err.message);
        reject(err);
      }
    });

    /* PDF DESIGN */
    doc.fontSize(22).text(event.title, { align: "center" });
    doc.moveDown();

    doc.fontSize(14).text(`Date: ${new Date(event.date).toLocaleString()}`);
    doc.text(`Location: ${event.location}`);
    doc.text(`Ticket ID: ${paymentId}`);
    doc.text(`Status: PAID`);

    doc.moveDown(2);

    const qrBuffer = Buffer.from(qrCodeDataUrl.split(",")[1], "base64");
    doc.image(qrBuffer, doc.page.width / 2 - 60, doc.y, { width: 120 });

    doc.end();
  });
}


/* =========================
   BUY ROUTE (FIXED)
========================= */
router.post("/buy", async (req, res) => {
  const { eventId, email, userId } = req.body;

  try {
    const event = await Event.findById(eventId);

    if (!event) return res.status(404).json({ error: "Event not found" });
    if (event.ticketsAvailable <= 0)
      return res.status(400).json({ error: "Sold out" });

    const paymentId = `evt-${eventId}-${Date.now()}`;

    const data = {
      merchant_id: process.env.PAYFAST_MERCHANT_ID,
      merchant_key: process.env.PAYFAST_MERCHANT_KEY,

      return_url: process.env.PAYFAST_RETURN_URL,
      cancel_url: process.env.PAYFAST_CANCEL_URL,
      notify_url: process.env.PAYFAST_NOTIFY_URL,

      name_first: "Customer",
      email_address: email,

      m_payment_id: paymentId,
      amount: event.price.toFixed(2),
      item_name: `Ticket for ${event.title}`,

      custom_str1: eventId,
      custom_str2: email
    };

    // ONLY add if exists (IMPORTANT)
    if (userId) {
      data.custom_str3 = userId;
    }

    data.signature = generateSignature(
      data,
      process.env.PAYFAST_PASSPHRASE || ""
    );

    const endpoint =
      process.env.PAYFAST_MODE === "live"
        ? "https://www.payfast.co.za/eng/process"
        : "https://sandbox.payfast.co.za/eng/process";

    res.json({ paymentData: data, endpoint });

  } catch (err) {
    console.error("❌ Buy error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});


/* =========================
   NOTIFY ROUTE
========================= */
router.post(
  "/notify",
  express.urlencoded({ extended: true }),
  async (req, res) => {
    console.log("🔥🔥 PAYFAST NOTIFY HIT 🔥🔥");
    console.log("BODY:", req.body);

    try {
      const pfData = { ...req.body };

      const receivedSig = pfData.signature;
      delete pfData.signature;

      const calculatedSig = generateSignature(
        pfData,
        process.env.PAYFAST_PASSPHRASE || ""
      );

      console.log("Generated Sig:", calculatedSig);
      console.log("Received Sig:", receivedSig);

      if (receivedSig !== calculatedSig) {
        console.log("❌ Invalid signature");
        return res.status(400).send("Invalid signature");
      }

      const valid = await verifyWithPayFast(pfData);
      console.log("PayFast validation:", valid);

      if (!valid) {
        console.log("❌ PayFast validation failed");
        return res.status(400).send("Invalid");
      }

      if (pfData.payment_status !== "COMPLETE") {
        console.log("⏳ Payment not complete");
        return res.sendStatus(200);
      }

      const exists = await Ticket.findOne({
        paymentId: pfData.m_payment_id
      });

      if (exists) {
        console.log("⚠️ Ticket already exists");
        return res.sendStatus(200);
      }

      const event = await Event.findById(pfData.custom_str1);
      if (!event) {
        console.log("❌ Event not found");
        return res.sendStatus(200);
      }

      const paid = parseFloat(pfData.amount_gross);
      console.log("Paid:", paid, "Expected:", event.price);

      if (Math.abs(paid - event.price) > 0.01) {
        console.log("❌ Amount mismatch");
        return res.sendStatus(200);
      }

      console.log("🎟️ Creating ticket...");

      const qrData = `ticket:${pfData.m_payment_id}:${pfData.email_address}`;
      const qr = await QRCode.toDataURL(qrData);

      const ticket = await Ticket.create({
        event: event._id,
        buyerEmail: pfData.email_address,
        qrCode: qr,
        paymentId: pfData.m_payment_id,
        status: "paid"
      });

      await Event.findByIdAndUpdate(event._id, {
        $inc: { ticketsAvailable: -1 }
      });

      console.log("📉 Ticket count reduced");

      await sendTicketEmail(
        event,
        pfData.email_address,
        qr,
        pfData.m_payment_id
      );

      console.log("📩 Email sent");

      console.log("✅ Ticket created:", ticket._id);

      return res.sendStatus(200);

    } catch (err) {
      console.error("❌ Notify error FULL:", err);
      return res.sendStatus(500);
    }
  }
);


module.exports = router;