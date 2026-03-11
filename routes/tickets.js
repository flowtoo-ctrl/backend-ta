const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { getUserTickets, getTicketById } = require('../utils/database');
const Ticket = require('../models/Ticket');

// Auth: Get user's tickets
router.get('/my', authMiddleware, async (req, res) => {
  try {
    // First try to get tickets by user ID
    let tickets = await getUserTickets(req.user.id);
    
    // If no tickets found by user ID, search by email
    if (tickets.length === 0 && req.user.email) {
      tickets = await Ticket.find({ buyerEmail: req.user.email })
        .populate('event')
        .sort({ createdAt: -1 });
    }
    
    res.json(tickets);
  } catch (err) {
    console.error('Error fetching tickets:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Auth: Get ticket by ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const ticket = await getTicketById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    // Verify ownership by user ID or email
    if (ticket.user && ticket.user.toString() !== req.user.id && ticket.buyerEmail !== req.user.email) {
      return res.status(403).json({ error: "You don't own this ticket" });
    }

    res.json(ticket);
  } catch (err) {
    console.error('Error fetching ticket:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
