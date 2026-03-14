const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { getUserTickets, getTicketById, getEventById } = require('../utils/database');
const Ticket = require('../models/Ticket');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');

// ============================================
// GET USER TICKETS
// ============================================

router.get('/my', authMiddleware, async (req, res) => {
  try {
    let tickets = await getUserTickets(req.user.id);

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


// ============================================
// BULK GENERATE TICKETS
// ============================================

router.post('/bulk-generate', authMiddleware, async (req, res) => {

  try {

    const { eventId, quantity } = req.body;

    if (!eventId || !quantity) {
      return res.status(400).json({ error: 'eventId and quantity required' });
    }

    if (quantity < 1 || quantity > 10000) {
      return res.status(400).json({ error: 'Quantity must be 1 - 10000' });
    }

    const event = await getEventById(eventId);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    console.log(`Generating ${quantity} tickets for ${event.title}`);

    const tickets = [];
    const qrPreview = [];

    for (let i = 0; i < quantity; i++) {

      const timestamp = Date.now();
      const ticketId = `${eventId}-${timestamp}-${i}`;

      const qrData = JSON.stringify({
        ticketId,
        eventId,
        eventName: event.title,
        ticketNumber: i + 1
      });

      const qrCode = await QRCode.toDataURL(qrData);

      const ticket = {
        ticketId,
        eventId,
        event: event._id,
        qrCode,
        status: 'available',
        buyerEmail: null,
        user: null,
        paymentId: `bulk-${timestamp}-${i}`,
        createdAt: new Date(),
        usedAt: null
      };

      tickets.push(ticket);

      if (i < 20) {
        qrPreview.push({
          ticketNumber: i + 1,
          ticketId,
          qrCode
        });
      }

      if ((i + 1) % 100 === 0) {
        console.log(`Generated ${i + 1}/${quantity}`);
      }
    }

    const savedTickets = await Ticket.insertMany(tickets);

    console.log(`Saved ${savedTickets.length} tickets`);

    res.json({
      success: true,
      ticketsGenerated: quantity,
      eventTitle: event.title,
      qrCodes: qrPreview
    });

  } catch (err) {

    console.error('Bulk generation error:', err);

    res.status(500).json({
      error: 'Bulk ticket generation failed',
      details: err.message
    });

  }

});


// ============================================
// EXPORT TICKETS PDF
// ============================================

router.post('/export-pdf', authMiddleware, async (req, res) => {

  try {

    const { eventId, quantity } = req.body;

    if (!eventId || !quantity) {
      return res.status(400).json({ error: 'eventId and quantity required' });
    }

    const event = await getEventById(eventId);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const doc = new PDFDocument({
      size: 'A4',
      margin: 10
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=tickets-${Date.now()}.pdf`
    );

    doc.pipe(res);

    const ticketsPerPage = 4;
    let count = 0;

    doc.fontSize(24).text(event.title);
    doc.moveDown();
    doc.fontSize(14).text(`Total Tickets: ${quantity}`);
    doc.addPage();

    for (let i = 0; i < quantity; i++) {

      if (count > 0 && count % ticketsPerPage === 0) {
        doc.addPage();
      }

      const ticketId = `${eventId}-${Date.now()}-${i}`;

      const qrData = JSON.stringify({
        ticketId,
        eventId
      });

      const qrBuffer = await QRCode.toBuffer(qrData);

      const y = 50 + (count % ticketsPerPage) * 190;

      doc.rect(30, y, 550, 180).stroke();

      doc.fontSize(14).text(event.title, 50, y + 10);

      doc.fontSize(10).text(`Ticket #${i + 1}`, 50, y + 40);

      doc.fontSize(9).text(
        `Date: ${new Date(event.date).toLocaleDateString()}`,
        50,
        y + 60
      );

      doc.fontSize(9).text(
        `Location: ${event.location}`,
        50,
        y + 75
      );

      doc.fontSize(9).text(
        `Price: R ${event.price}`,
        50,
        y + 90
      );

      doc.image(qrBuffer, 450, y + 20, {
        width: 100,
        height: 100
      });

      doc.fontSize(7).text(
        `Ticket ID: ${ticketId}`,
        50,
        y + 150
      );

      count++;

    }

    doc.end();

  } catch (err) {

    console.error('PDF export error:', err);

    res.status(500).json({
      error: 'PDF export failed',
      details: err.message
    });

  }

});


// ============================================
// VERIFY TICKET (QR SCAN)
// ============================================

router.post('/verify', async (req, res) => {

  try {

    const { ticketId } = req.body;

    if (!ticketId) {
      return res.status(400).json({
        valid: false,
        message: 'Ticket ID required'
      });
    }

    const ticket = await Ticket.findOne({ ticketId }).populate('event');

    if (!ticket) {
      return res.json({
        valid: false,
        message: 'Ticket not found'
      });
    }

    if (ticket.status === 'used') {
      return res.json({
        valid: false,
        message: 'Ticket already used',
        usedAt: ticket.usedAt
      });
    }

    ticket.status = 'used';
    ticket.usedAt = new Date();

    await ticket.save();

    res.json({
      valid: true,
      message: 'Ticket verified',
      event: ticket.event?.title,
      ticketId
    });

  } catch (err) {

    console.error('Verification error:', err);

    res.status(500).json({
      valid: false,
      error: 'Server error'
    });

  }

});


// ============================================
// TICKET STATS
// ============================================

router.get('/stats/:eventId', authMiddleware, async (req, res) => {

  try {

    const { eventId } = req.params;

    const event = await getEventById(eventId);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const total = await Ticket.countDocuments({ eventId });

    const used = await Ticket.countDocuments({
      eventId,
      status: 'used'
    });

    const available = await Ticket.countDocuments({
      eventId,
      status: 'available'
    });

    const sold = await Ticket.countDocuments({
      eventId,
      status: 'sold'
    });

    res.json({
      eventTitle: event.title,
      totalTickets: total,
      usedTickets: used,
      availableTickets: available,
      soldTickets: sold,
      usagePercentage:
        total > 0
          ? ((used / total) * 100).toFixed(2)
          : 0
    });

  } catch (err) {

    console.error('Stats error:', err);

    res.status(500).json({
      error: 'Server error'
    });

  }

});


// ============================================
// GET SINGLE TICKET
// ============================================

router.get('/:id', authMiddleware, async (req, res) => {

  try {

    const ticket = await getTicketById(req.params.id);

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    if (
      ticket.user &&
      ticket.user.toString() !== req.user.id &&
      ticket.buyerEmail !== req.user.email
    ) {
      return res.status(403).json({
        error: "You don't own this ticket"
      });
    }

    res.json(ticket);

  } catch (err) {

    console.error('Ticket fetch error:', err);

    res.status(500).json({
      error: 'Server error'
    });

  }

});

module.exports = router;