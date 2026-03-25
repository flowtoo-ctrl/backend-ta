const express = require("express");
const router = express.Router();
const Event = require("../models/Event");
const Ticket = require("../models/Ticket");

/* =========================
   DASHBOARD STATS
========================= */
router.get("/stats", async (req, res) => {
  try {
    const totalEvents = await Event.countDocuments();
    const totalTickets = await Ticket.countDocuments({ status: "paid" });

    const revenueData = await Ticket.aggregate([
      { $match: { status: "paid" } },
      {
        $lookup: {
          from: "events",
          localField: "event",
          foreignField: "_id",
          as: "eventData"
        }
      },
      { $unwind: "$eventData" },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$eventData.price" }
        }
      }
    ]);

    const totalRevenue = revenueData[0]?.totalRevenue || 0;

    res.json({
      totalEvents,
      totalTickets,
      totalRevenue
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


/* =========================
   ALL TICKETS
========================= */
router.get("/tickets", async (req, res) => {
  try {
    const tickets = await Ticket.find()
      .populate("event")
      .sort({ createdAt: -1 });

    res.json(tickets);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* =========================
   ALL EVENTS
========================= */
router.get("/events", async (req, res) => {
  try {
    const events = await Event.find().sort({ createdAt: -1 });
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

