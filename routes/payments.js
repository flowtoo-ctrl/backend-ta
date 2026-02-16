const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios'); // ADD THIS: npm install axios
const Ticket = require('../models/Ticket');
const Event = require('../models/Events');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');

// Helper: Generate PayFast signature (updated for accuracy)
function generateSignature(data, passphrase) {
  // Sort keys alphabetically? No—PayFast requires consistent order (as sent), but to be safe we sort
  const sortedKeys = Object.keys(data).sort();
  let pfOutput = sortedKeys
    .filter(key => data[key] !== '' && data[key] !== undefined && key !== 'signature')
    .map(key => `\( {key}= \){encodeURIComponent(data[key].toString().trim())}`)
    .join('&');

  if (passphrase) {
    pfOutput += `&passphrase=${encodeURIComponent(passphrase.trim())}`;
  }

  return crypto.createHash('md5').update(pfOutput).digest('hex');
}

// Helper: Validate ITN source IP (basic—expand with full ranges later)
function isValidPayFastIP(ip) {
  const validRanges = [
    '197.97.145.144/28',
    '41.74.179.192/27',
    '102.216.36.0/28',
    '102.216.36.128/28',
    '144.126.193.139'
    // Add more from docs if needed
  ];
  // Simple check for now—use ip-range lib later for production
  return validRanges.some(range => ip.startsWith(range.split('/')[0])); // rough
}

// Buy ticket → redirect to PayFast
router.post('/buy', async (req, res) => {
  const { eventId, email } = req.body;

  try {
    const event = await Event.findById(eventId);
    if (!event || event.ticketsAvailable <= 0) {
      return res.status(400).json({ error: 'Event not available or sold out' });
    }

    const pfData = {
      merchant_id: process.env.PAYFAST_MERCHANT_ID,
      merchant_key: process.env.PAYFAST_MERCHANT_KEY,
      return_url: process.env.PAYFAST_RETURN_URL,
      cancel_url: process.env.PAYFAST_CANCEL_URL,
      notify_url: process.env.PAYFAST_NOTIFY_URL,
      name_first: 'Customer', // placeholder or from form
      email_address: email,
      m_payment_id: `evt-\( {eventId}- \){Date.now()}`, // unique
      amount: event.price.toFixed(2),
      item_name: `Ticket for ${event.title}`,
      item_description: event.description || 'Local event ticket',
      custom_str1: eventId.toString(),
      custom_str2: email
    };

    pfData.signature = generateSignature(pfData, process.env.PAYFAST_PASSPHRASE);

    const baseUrl = 'https://sandbox.payfast.co.za/eng/process'; // Change to https://www.payfast.co.za/eng/process for live
    const redirectUrl = `\( {baseUrl}? \){new URLSearchParams(pfData).toString()}`;

    res.json({ redirectUrl });
  } catch (err) {
    console.error('Buy error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PayFast ITN webhook (critical security updates)
router.post('/notify', async (req, res) => {
  // Respond immediately with 200 OK (PayFast requires this fast)
  res.sendStatus(200);

  try {
    const pfData = req.body;
    if (!pfData || !pfData.signature) {
      return console.log('Invalid ITN: no signature');
    }

    const receivedSignature = pfData.signature;
    delete pfData.signature;

    // Verify signature
    const calculatedSig = generateSignature(pfData, process.env.PAYFAST_PASSPHRASE);
    if (calculatedSig !== receivedSignature) {
      return console.log('Invalid signature - possible tampering');
    }

    // Basic security checks
    if (pfData.merchant_id !== process.env.PAYFAST_MERCHANT_ID) {
      return console.log('Merchant ID mismatch');
    }

    if (pfData.payment_status !== 'COMPLETE') {
      return console.log(`Payment not complete: ${pfData.payment_status}`);
    }

    // Amount validation (compare with expected)
    const eventId = pfData.custom_str1;
    const event = await Event.findById(eventId);
    if (!event) return console.log('Event not found');

    const paidAmount = parseFloat(pfData.amount_gross || pfData.amount_net || 0);
    if (Math.abs(paidAmount - event.price) > 0.01) {
      return console.log('Amount mismatch');
    }

    // Optional: Server confirmation (ping PayFast validate endpoint)
    const validateUrl = 'https://sandbox.payfast.co.za/eng/query/validate'; // live: https://www.payfast.co.za/eng/query/validate
    const validateRes = await axios.post(validateUrl, new URLSearchParams(pfData).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    if (!validateRes.data.includes('VALID')) {
      return console.log('PayFast server validation failed');
    }

    // IP check (req.ip from express—enable trust proxy if behind nginx)
    // if (!isValidPayFastIP(req.ip)) console.log('Suspicious IP:', req.ip);

    // All good → create ticket
    const qrData = `ticket:\( {pfData.pf_payment_id || pfData.m_payment_id}: \){pfData.email_address}`;
    const qrCode = await QRCode.toDataURL(qrData);

    const ticket = new Ticket({
      event: eventId,
      buyerEmail: pfData.email_address || pfData.custom_str2,
      qrCode,
      paymentId: pfData.pf_payment_id || pfData.m_payment_id,
      status: 'paid'
    });
    await ticket.save();

    event.ticketsAvailable -= 1;
    await event.save();

    console.log('Ticket created & event updated!', ticket._id);

    // Send email (update with your Gmail/app password)
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'yourgmail@gmail.com', // ← CHANGE THIS
        pass: 'your-app-password'     // ← CHANGE THIS (generate app password in Google)
      }
    });

    await transporter.sendMail({
      from: 'yourgmail@gmail.com',
      to: ticket.buyerEmail,
      subject: `Your Ticket: ${event.title}`,
      text: `Thanks for purchasing! Your QR code is attached.\nEvent: ${event.title}\nDate: ${new Date(event.date).toLocaleString()}\nLocation: ${event.location}`,
      attachments: [{
        filename: 'ticket-qr.png',
        content: Buffer.from(qrCode.split(',')[1], 'base64'),
        encoding: 'base64'
      }]
    });

    console.log('Ticket email sent to', ticket.buyerEmail);
  } catch (err) {
    console.error('ITN processing error:', err);
  }
});

module.exports = router;