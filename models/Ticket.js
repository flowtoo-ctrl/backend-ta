const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema({
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Event",
    required: true
  },
  buyerEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  ticketType: {
    type: String,
    required: true,
    trim: true
  },
  qrCode: {
    type: String, // Base64 data URL from QRCode.toDataURL()
    required: true
  },
  paymentId: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ["paid", "used", "cancelled"],
    default: "paid"
  },
  amount: {
    type: Number,
    required: true
  },
  usedAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Ticket = mongoose.model("Ticket", ticketSchema);

module.exports = Ticket;

