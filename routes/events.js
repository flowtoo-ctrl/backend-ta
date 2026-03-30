const express = require('express');
const mongoose = require('mongoose');  // ADDED: for ObjectId validation
const router = express.Router();
const authMiddleware = require('../middleware/auth');

// Import your Event model directly (better than using utils/database for now)
const Event = require('../models/Event');

// =====================
// HELPER FUNCTIONS
// =====================

// Validate MongoDB ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

// Validate date string
const isValidDate = (dateString) => {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
};

// =====================
// PUBLIC ROUTES
// =====================

// Get all events
router.get('/', async (req, res) => {
  try {
    console.log("📋 Fetching all events");
    const events = await Event.find().sort({ date: 1 });
    console.log(`✓ Found ${events.length} events`);
    res.json(events);
  } catch (err) {
    console.error('✗ Error fetching events:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get event by ID (Used by EventDetails.jsx)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ID format
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid event ID format' });
    }
    
    console.log("📋 Fetching event:", id);
    const event = await Event.findById(id);
    
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

// =====================
// PROTECTED ROUTES (Admin only)
// =====================

// Create new event with multiple ticket types
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, description, date, location, ticketTypes, image } = req.body;

    // Validation
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }
    
    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }
    
    if (!isValidDate(date)) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    
    if (!ticketTypes || !Array.isArray(ticketTypes) || ticketTypes.length === 0) {
      return res.status(400).json({ error: 'At least one ticket type is required' });
    }

    // Validate ticket types
    for (const ticket of ticketTypes) {
      if (!ticket.name || !ticket.name.trim()) {
        return res.status(400).json({ error: 'Each ticket type must have a name' });
      }
      
      // Check price exists and is a number (0 is valid)
      if (ticket.price === undefined || ticket.price === null || ticket.price === '') {
        return res.status(400).json({ error: 'Each ticket type must have a price' });
      }
      
      // Check quantity exists and is a number (0 is valid)
      if (ticket.quantity === undefined || ticket.quantity === null || ticket.quantity === '') {
        return res.status(400).json({ error: 'Each ticket type must have a quantity' });
      }
      
      const price = parseFloat(ticket.price);
      const quantity = parseInt(ticket.quantity, 10);
      
      if (isNaN(price) || price < 0) {
        return res.status(400).json({ error: 'Price must be a non-negative number' });
      }
      
      if (isNaN(quantity) || quantity < 0) {
        return res.status(400).json({ error: 'Quantity must be a non-negative integer' });
      }
    }

    console.log("🎫 Creating new event:", title);

    const eventData = {
      title: title.trim(),
      description: description || '',
      date: new Date(date),
      location: location || '',
      image: image || '',
      ticketTypes: ticketTypes.map(t => ({
        name: t.name.trim(),
        price: parseFloat(t.price),
        quantity: parseInt(t.quantity, 10)
      })),
      createdBy: req.user.id,
    };

    const event = await Event.create(eventData);
    
    console.log("✓ Event created successfully:", event._id);
    res.status(201).json(event);

  } catch (err) {
    console.error('✗ Error creating event:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update event
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, date, location, ticketTypes, image } = req.body;

    // Validate ID format
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid event ID format' });
    }

    console.log("🔄 Updating event:", id);

    // Find event first to check ownership
    const existingEvent = await Event.findById(id);
    if (!existingEvent) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check ownership - only creator can update
    if (existingEvent.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to update this event' });
    }

    const updateData = {};
    
    if (title !== undefined) {
      if (!title.trim()) {
        return res.status(400).json({ error: 'Title cannot be empty' });
      }
      updateData.title = title.trim();
    }
    
    if (description !== undefined) updateData.description = description;
    
    if (date !== undefined) {
      if (!isValidDate(date)) {
        return res.status(400).json({ error: 'Invalid date format' });
      }
      updateData.date = new Date(date);
    }
    
    if (location !== undefined) updateData.location = location;
    if (image !== undefined) updateData.image = image;

    // Update ticket types if provided
    if (ticketTypes !== undefined) {
      if (!Array.isArray(ticketTypes) || ticketTypes.length === 0) {
        return res.status(400).json({ error: 'Ticket types must be a non-empty array' });
      }
      
      // Validate all ticket types
      for (const ticket of ticketTypes) {
        if (!ticket.name || !ticket.name.trim()) {
          return res.status(400).json({ error: 'Each ticket type must have a name' });
        }
        if (ticket.price === undefined || ticket.price === null) {
          return res.status(400).json({ error: 'Each ticket type must have a price' });
        }
        if (ticket.quantity === undefined || ticket.quantity === null) {
          return res.status(400).json({ error: 'Each ticket type must have a quantity' });
        }
        
        const price = parseFloat(ticket.price);
        const quantity = parseInt(ticket.quantity, 10);
        
        if (isNaN(price) || price < 0) {
          return res.status(400).json({ error: 'Price must be a non-negative number' });
        }
        if (isNaN(quantity) || quantity < 0) {
          return res.status(400).json({ error: 'Quantity must be a non-negative integer' });
        }
      }
      
      updateData.ticketTypes = ticketTypes.map(t => ({
        name: t.name.trim(),
        price: parseFloat(t.price),
        quantity: parseInt(t.quantity, 10)
      }));
    }

    // Check if there's anything to update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }

    const event = await Event.findByIdAndUpdate(
      id, 
      updateData, 
      { new: true, runValidators: true }
    );

    console.log("✓ Event updated successfully");
    res.json(event);
  } catch (err) {
    console.error('✗ Error updating event:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete event
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ID format
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid event ID format' });
    }

    console.log("🗑️ Deleting event:", id);

    // Find event first to check ownership
    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check ownership - only creator can delete
    if (event.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this event' });
    }

    await Event.findByIdAndDelete(id);

    console.log("✓ Event deleted successfully");
    res.json({ success: true, message: 'Event deleted' });
  } catch (err) {
    console.error('✗ Error deleting event:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;


