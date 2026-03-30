const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const QRCode = require("qrcode");

const Event = require("../models/Event");
const Ticket = require("../models/Ticket");

// =========================
// SIGNATURE GENERATION
// =========================
function generateSignature(data, passphrase = "") {
  let pfOutput = "";

  Object.keys(data)
    .sort()
    .forEach((key) => {
      const value = data[key];
      if (value !== "" && value !== null && value !== undefined) {
        pfOutput += `${key}=${encodeURIComponent(value).replace(/%20/g, "+")}&`;
      }
    });

  pfOutput = pfOutput.slice(0, -1);

  if (passphrase) {
    pfOutput += `&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}`;
  }

  return crypto.createHash("md5").update(pfOutput).digest("hex");
}

// =========================
// PAY ROUTE
// =========================
router.post("/pay", async (req, res) => {
  try {
    console.log("🔥 PAY ROUTE HIT", req.body);

    const { eventId, email, ticketType, firstName, lastName } = req.body;

    if (!eventId || !email || !ticketType) {
      return res.status(400).json({ 
        message: "eventId, email, and ticketType are required" 
      });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const selectedTicket = event.ticketTypes.find(t => t.name === ticketType);
    if (!selectedTicket) {
      return res.status(400).json({ message: "Invalid ticket type selected" });
    }

    if (selectedTicket.quantity <= 0) {
      return res.status(400).json({ message: "Selected ticket type is sold out" });
    }

    const paymentData = {
      merchant_id: process.env.PAYFAST_MERCHANT_ID,
      merchant_key: process.env.PAYFAST_MERCHANT_KEY,
      return_url: `${process.env.BASE_URL}/success`,
      cancel_url: `${process.env.BASE_URL}/cancel`,
      notify_url: `${process.env.BASE_URL}/api/payments/notify`,
      m_payment_id: `ticket_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      amount: Number(selectedTicket.price).toFixed(2),
      item_name: `${selectedTicket.name} Ticket - ${event.title}`.substring(0, 255),
      email_address: email.trim(),
      name_first: firstName || "Guest",
      name_last: lastName || "User",
      custom_str1: event._id.toString(),
      custom_str2: ticketType,
      custom_str3: selectedTicket.price.toString()
    };

    const signature = generateSignature(paymentData, process.env.PAYFAST_PASSPHRASE || "");
    paymentData.signature = signature;

    const url = process.env.PAYFAST_SANDBOX === "true"
      ? "https://sandbox.payfast.co.za/eng/process"
      : "https://www.payfast.co.za/eng/process";

    console.log(`✅ Payment ready for ${ticketType} ticket`);

    return res.json({ url, data: paymentData });

  } catch (err) {
    console.error("❌ PAY ERROR FULL:", err.stack || err);
    return res.status(500).json({
      message: "Error initiating payment",
      error: err.message
    });
  }
});

// =========================
// NOTIFY ROUTE - FIXED
// =========================
router.post(
  "/notify",
  express.urlencoded({ extended: true }),
  async (req, res) => {
    console.log("🔥 NOTIFY HIT", req.body);

    try {
      const pfData = { ...req.body };

      if (pfData.payment_status !== "COMPLETE") {
        console.log("❌ Payment not complete");
        return res.sendStatus(200);
      }

      // Verify signature
      const receivedSig = pfData.signature;
      delete pfData.signature;

      const calculatedSig = generateSignature(pfData, process.env.PAYFAST_PASSPHRASE || "");
      
      if (receivedSig !== calculatedSig) {
        console.log("❌ Invalid signature");
        return res.sendStatus(400);
      }

      // Prevent duplicate
      const exists = await Ticket.findOne({ paymentId: pfData.m_payment_id });
      if (exists) {
        console.log("⚠️ Ticket already exists");
        return res.sendStatus(200);
      }

      const event = await Event.findById(pfData.custom_str1);
      if (!event) {
        console.log("❌ Event not found");
        return res.sendStatus(200);
      }

      const ticketType = pfData.custom_str2;

      // Verify amount matches
      const expectedAmount = parseFloat(pfData.custom_str3);
      const receivedAmount = parseFloat(pfData.amount_gross || pfData.amount || 0);
      
      if (Math.abs(receivedAmount - expectedAmount) > 0.01) {
        console.log("❌ Amount mismatch");
        return res.sendStatus(400);
      }

      // Generate QR Code
      const qr = await QRCode.toDataURL(
        `ticket:${pfData.m_payment_id}:${pfData.email_address || "unknown"}`
      );

      // Create Ticket
      await Ticket.create({
        event: event._id,
        buyerEmail: pfData.email_address,
        ticketType: ticketType,
        qrCode: qr,
        paymentId: pfData.m_payment_id,
        status: "paid",
        amount: receivedAmount
      });

      console.log(`🎟️ Ticket created for ${ticketType}`);

      // Reduce quantity for the specific ticket type
      await Event.findByIdAndUpdate(
        event._id,
        { $inc: { "ticketTypes.$[elem].quantity": -1 } },
        { 
          arrayFilters: [{ "elem.name": ticketType }] 
        }
      );

      console.log(`📉 Reduced quantity for ticket type: ${ticketType}`);

      return res.sendStatus(200);

    } catch (err) {
      console.error("❌ NOTIFY ERROR:", err.message);
      return res.sendStatus(200); // Always return 200 to PayFast
    }
  }
);

module.exports = router;
