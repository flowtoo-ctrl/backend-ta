const mongoose = require("mongoose");

const ticketTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    enum: ["VIP", "General", "Early Bird", "Student", "Other"] // Add more types as needed
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  quantity: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  }
}, { _id: false }); // No separate _id for subdocuments

const eventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  location: {
    type: String,
    required: true,
    trim: true
  },
  image: {
    type: String, // URL to event image (optional)
    default: ""
  },
  
  // Multiple ticket types with prices and quantities
  ticketTypes: {
    type: [ticketTypeSchema],
    required: true,
    validate: {
      validator: function(types) {
        return types && types.length > 0;
      },
      message: "Event must have at least one ticket type"
    }
  },

  // Optional: Total tickets available (calculated or manual)
  totalTickets: {
    type: Number,
    default: function() {
      return this.ticketTypes ? 
        this.ticketTypes.reduce((sum, t) => sum + t.quantity, 0) : 0;
    }
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true // Auto updates updatedAt
});

// Pre-save hook to calculate totalTickets
eventSchema.pre("save", function(next) {
  if (this.ticketTypes && this.ticketTypes.length > 0) {
    this.totalTickets = this.ticketTypes.reduce((sum, ticket) => sum + ticket.quantity, 0);
  }
  next();
});

// Index for faster queries
eventSchema.index({ date: 1 });
eventSchema.index({ "ticketTypes.name": 1 });

const Event = mongoose.model("Event", eventSchema);

module.exports = Event;

