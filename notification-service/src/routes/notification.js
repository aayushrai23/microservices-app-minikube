const express = require('express');
const { Notification } = require('../db');
const router = express.Router();

// POST /send — payment service yahan call karta hai
router.post('/send', async (req, res) => {
  const { user_id, type, subject, message, email } = req.body;

  if (!user_id || !message)
    return res.status(400).json({ error: 'user_id and message required' });

  try {
    // Notification MongoDB mein save karo
    const notification = await Notification.create({
      user_id,
      type:    type || 'general',
      subject,
      message,
      email,
      status: 'sent'
    });

    // Console mein log karo — debugging ke liye useful
    console.log(`📧 Notification → [${type}] to ${email}: ${message}`);

    res.status(201).json({
      message: 'Notification sent',
      notification
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not send notification' });
  }
});

// GET /user/:userId — ek user ki saari notifications
router.get('/user/:userId', async (req, res) => {
  try {
    const notifications = await Notification
      .find({ user_id: req.params.userId })
      .sort({ created_at: -1 });
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// GET / — saari notifications
router.get('/', async (req, res) => {
  try {
    const notifications = await Notification
      .find()
      .sort({ created_at: -1 })
      .limit(100);
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

module.exports = router;
