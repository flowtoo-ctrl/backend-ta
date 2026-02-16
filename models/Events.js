const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  date: { type: Date, required: true },
  location: String,
  price: { type: Number, required: true },
  organizer: String, // simple string for now
  ticketsAvailable: { type: Number, default: 100 }
});

module.exports = mongoose.model('Event', eventSchema);

