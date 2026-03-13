const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const upload = require("../middleware/upload");
const {
  createEvent,
  getAllEvents,
  getEventById,
  updateEvent,
  deleteEvent,
} = require('../utils/database');

// Public: Get all events
router.get('/', async (req, res) => {
  try {
    console.log("📋 Fetching all events");
    const events = await getAllEvents();
    console.log(`✓ Found ${events.length} events`);
    res.json(events);
  } catch (err) {
    console.error('✗ Error fetching events:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Public: Get event by ID
router.get('/:id', async (req, res) => {
  try {
    console.log("📋 Fetching event:", req.params.id);
    const event = await getEventById(req.params.id);
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    console.log("✓ Event found:", event.title);
    res.json(event);
  } catch (err) {
    console.error('✗ Error fetching event:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Auth: Create event (admin only)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, description, date, location, price, ticketsAvailable, image } = req.body;

    // Validate required fields
    if (!title || !date || !price || !ticketsAvailable) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log("🎫 Creating new event:", title);

    const eventData = {
      title,
      description: description || '',
      date: new Date(date),
      location: location || '',
      price: parseFloat(price),
      ticketsAvailable: parseInt(ticketsAvailable),
      image: image || '',
      createdBy: req.user.id,
    };

    const event = await createEvent(eventData);
    console.log("✓ Event created successfully:", event._id);
    res.status(201).json(event);
  } catch (err) {
    console.error('✗ Error creating event:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Auth: Update event (admin only)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { title, description, date, location, price, ticketsAvailable, image } = req.body;

    console.log("🔄 Updating event:", req.params.id);

    const updateData = {};
    if (title) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (date) updateData.date = new Date(date);
    if (location !== undefined) updateData.location = location;
    if (price) updateData.price = parseFloat(price);
    if (ticketsAvailable) updateData.ticketsAvailable = parseInt(ticketsAvailable);
    if (image !== undefined) updateData.image = image;

    const event = await updateEvent(req.params.id, updateData);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    console.log("✓ Event updated successfully");
    res.json(event);
  } catch (err) {
    console.error('✗ Error updating event:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Auth: Delete event (admin only)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    console.log("🗑️ Deleting event:", req.params.id);

    const event = await deleteEvent(req.params.id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    console.log("✓ Event deleted successfully");
    res.json({ success: true, message: 'Event deleted' });
  } catch (err) {
    console.error('✗ Error deleting event:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;


