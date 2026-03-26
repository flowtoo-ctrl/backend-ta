const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const QRCode = require("qrcode");

const Event = require("../models/Event");
const Ticket = require("../models/Ticket");

// =========================
// SIGNATURE
// =========================
function generateSignature(data, passphrase = "") {
  let pfOutput = "";

  Object.keys(data)
    .sort()
    .forEach(key => {
      if (data[key] !== "") {
        pfOutput += `${key}=${encodeURIComponent(data[key]).replace(/%20/g, "+")}&`;
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
    console.log("🔥 PAY ROUTE HIT");
    console.log("BODY:", req.body);

    const { eventId, email } = req.body;

    // =========================
    // VALIDATION
    // =========================
    if (!eventId || !email) {
      console.log("❌ Missing eventId or email");
      return res.status(400).json({
        message: "eventId and email are required"
      });
    }

    const event = await Event.findById(eventId);

    if (!event) {
      console.log("❌ Event NOT found:", eventId);
      return res.status(404).json({
        message: "Event not found"
      });
    }

    console.log("✅ Event found:", event.title);

    if (!event.price) {
      console.log("❌ Event has no price");
      return res.status(400).json({
        message: "Event price missing"
      });
    }

    // =========================
    // ENV CHECK
    // =========================
    if (!process.env.PAYFAST_MERCHANT_ID) {
      console.log("❌ Missing MERCHANT_ID");
    }
    if (!process.env.PAYFAST_MERCHANT_KEY) {
      console.log("❌ Missing MERCHANT_KEY");
    }
    if (!process.env.BASE_URL) {
      console.log("❌ Missing BASE_URL");
    }

    // =========================
    // PAYMENT DATA
    // =========================
    const paymentData = {
      merchant_id: process.env.PAYFAST_MERCHANT_ID,
      merchant_key: process.env.PAYFAST_MERCHANT_KEY,

      return_url: `${process.env.BASE_URL}/success`,
      cancel_url: `${process.env.BASE_URL}/cancel`,
      notify_url: `${process.env.BASE_URL}/api/payments/notify`,

      m_payment_id: Date.now().toString(),

      amount: Number(event.price).toFixed(2),
      item_name: `Ticket for ${event.title}`,

      email_address: email,
      custom_str1: event._id.toString()
    };

    console.log("💰 Payment Data:", paymentData);

    const signature = generateSignature(
      paymentData,
      process.env.PAYFAST_PASSPHRASE || ""
    );

    paymentData.signature = signature;

    const url =
      process.env.PAYFAST_SANDBOX === "true"
        ? "https://sandbox.payfast.co.za/eng/process"
        : "https://www.payfast.co.za/eng/process";

    console.log("🚀 Sending to PayFast");

    return res.json({
      url,
      data: paymentData
    });

  } catch (err) {
    console.error("❌ PAY ERROR FULL:", err);
    return res.status(500).json({
      message: "Error initiating payment",
      error: err.message
    });
  }
});

// =========================
// 🔥 NOTIFY (FINAL FIX)
// =========================
router.post(
  "/notify",
  express.urlencoded({ extended: true }),
  async (req, res) => {

    console.log("🔥 NOTIFY HIT");
    console.log(req.body);

    try {
      const pfData = req.body;

      // ONLY check payment complete
      if (pfData.payment_status !== "COMPLETE") {
        console.log("❌ Not complete");
        return res.sendStatus(200);
      }

      // prevent duplicate
      const exists = await Ticket.findOne({
        paymentId: pfData.m_payment_id
      });

      if (exists) {
        console.log("⚠️ Already exists");
        return res.sendStatus(200);
      }

      // get event
      const event = await Event.findById(pfData.custom_str1);

      if (!event) {
        console.log("❌ Event not found");
        return res.sendStatus(200);
      }

      console.log("✅ Event:", event.title);

      // create QR
      const qr = await QRCode.toDataURL(
        `ticket:${pfData.m_payment_id}:${pfData.email_address}`
      );

      // create ticket
      const ticket = await Ticket.create({
        event: event._id,
        buyerEmail: pfData.email_address,
        qrCode: qr,
        paymentId: pfData.m_payment_id,
        status: "paid"
      });

      console.log("🎟️ Ticket created:", ticket._id);

      // reduce count
      await Event.findByIdAndUpdate(event._id, {
        $inc: { ticketsAvailable: -1 }
      });

      console.log("📉 Tickets reduced");

      return res.sendStatus(200);

    } catch (err) {
      console.error("❌ ERROR:", err);
      return res.sendStatus(500);
    }
  }
);

module.exports = router;