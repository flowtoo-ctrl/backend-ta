const User = require('../models/User');
const Event = require('../models/Event');
const Ticket = require('../models/Ticket');

// ============================================
// USER FUNCTIONS
// ============================================

async function createUser(userData) {
  try {
    console.log("Creating user:", userData.email);
    const user = new User(userData);
    await user.save();
    console.log("User created successfully:", user._id);
    return user;
  } catch (error) {
    console.error('Error creating user:', error);
    throw error;
  }
}

async function getUserByEmail(email) {
  try {
    const user = await User.findOne({ email });
    return user;
  } catch (error) {
    console.error('Error getting user by email:', error);
    throw error;
  }
}

async function getUserById(id) {
  try {
    const user = await User.findById(id);
    return user;
  } catch (error) {
    console.error('Error getting user by id:', error);
    throw error;
  }
}

async function updateUser(id, updateData) {
  try {
    const user = await User.findByIdAndUpdate(id, updateData, { new: true });
    return user;
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
}

// ============================================
// EVENT FUNCTIONS
// ============================================

async function createEvent(eventData) {
  try {
    console.log("Creating event:", eventData.title);
    const event = new Event(eventData);
    await event.save();
    console.log("Event created successfully:", event._id);
    return event;
  } catch (error) {
    console.error('Error creating event:', error);
    throw error;
  }
}

async function getAllEvents() {
  try {
    const events = await Event.find().sort({ date: 1 });
    return events;
  } catch (error) {
    console.error('Error getting all events:', error);
    throw error;
  }
}

async function getEventById(id) {
  try {
    const event = await Event.findById(id);
    return event;
  } catch (error) {
    console.error('Error getting event by id:', error);
    throw error;
  }
}

async function updateEvent(id, updateData) {
  try {
    const event = await Event.findByIdAndUpdate(id, updateData, { new: true });
    return event;
  } catch (error) {
    console.error('Error updating event:', error);
    throw error;
  }
}

async function updateEventTicketsAvailable(eventId, newCount) {
  try {
    console.log(`Updating event ${eventId} tickets to ${newCount}`);
    const event = await Event.findByIdAndUpdate(
      eventId,
      { ticketsAvailable: newCount },
      { new: true }
    );
    console.log("Event tickets updated successfully");
    return event;
  } catch (error) {
    console.error('Error updating event tickets:', error);
    throw error;
  }
}

async function deleteEvent(id) {
  try {
    const event = await Event.findByIdAndDelete(id);
    return event;
  } catch (error) {
    console.error('Error deleting event:', error);
    throw error;
  }
}

// ============================================
// TICKET FUNCTIONS
// ============================================

async function createTicket(data) {
  try {
    console.log("Creating ticket with data:", data);
    const ticket = new Ticket(data);
    await ticket.save();
    console.log("Ticket saved successfully:", ticket._id);
    return ticket;
  } catch (error) {
    console.error('Error creating ticket:', error);
    throw error;
  }
}

async function getUserTickets(userId) {
  try {
    console.log("Fetching tickets for user:", userId);
    const tickets = await Ticket.find({ user: userId })
      .populate('event')
      .sort({ createdAt: -1 });
    console.log(`Found ${tickets.length} tickets for user`);
    return tickets;
  } catch (error) {
    console.error('Error getting user tickets:', error);
    throw error;
  }
}

async function getTicketsByEmail(email) {
  try {
    console.log("Fetching tickets for email:", email);
    const tickets = await Ticket.find({ buyerEmail: email })
      .populate('event')
      .sort({ createdAt: -1 });
    console.log(`Found ${tickets.length} tickets for email`);
    return tickets;
  } catch (error) {
    console.error('Error getting tickets by email:', error);
    throw error;
  }
}

async function getTicketById(id) {
  try {
    const ticket = await Ticket.findById(id).populate('event');
    return ticket;
  } catch (error) {
    console.error('Error getting ticket by id:', error);
    throw error;
  }
}

async function getTicketByPaymentId(paymentId) {
  try {
    console.log("Fetching ticket for payment:", paymentId);
    const ticket = await Ticket.findOne({ paymentId }).populate('event');
    return ticket;
  } catch (error) {
    console.error('Error getting ticket by payment id:', error);
    throw error;
  }
}

async function updateTicket(id, updateData) {
  try {
    const ticket = await Ticket.findByIdAndUpdate(id, updateData, { new: true })
      .populate('event');
    return ticket;
  } catch (error) {
    console.error('Error updating ticket:', error);
    throw error;
  }
}

async function deleteTicket(id) {
  try {
    const ticket = await Ticket.findByIdAndDelete(id);
    return ticket;
  } catch (error) {
    console.error('Error deleting ticket:', error);
    throw error;
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // User functions
  createUser,
  getUserByEmail,
  getUserById,
  updateUser,

  // Event functions
  createEvent,
  getAllEvents,
  getEventById,
  updateEvent,
  updateEventTicketsAvailable,
  deleteEvent,

  // Ticket functions
  createTicket,
  getUserTickets,
  getTicketsByEmail,
  getTicketById,
  getTicketByPaymentId,
  updateTicket,
  deleteTicket,
};


