const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
  buyerEmail: String,
  qrCode: String, // base64 or path
  status: { type: String, default: 'pending' },
  paymentId: String
});

module.exports = mongoose.model('Ticket', ticketSchema);

