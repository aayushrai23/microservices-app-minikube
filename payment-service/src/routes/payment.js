const express = require('express');
const axios = require('axios');
const { Payment } = require('../db');
const router = express.Router();

// Service URLs — Kubernetes mein ye ConfigMap se aayenge
const AUTH_URL  = process.env.AUTH_SERVICE_URL  || 'http://auth-service:3001';
const NOTIF_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3003';

// Transaction ID generator — uuid library ki jagah
const generateTxnId = () =>
  'txn_' + Math.random().toString(36).slice(2, 10) +
  Date.now().toString(36);

// Middleware — har request pe auth service se token verify karo
const authenticate = async (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token)
    return res.status(401).json({ error: 'Authorization required' });
  try {
    // Auth service ko call karo — service to service communication
    const { data } = await axios.post(
      AUTH_URL + '/api/auth/verify', {},
      { headers: { Authorization: token } }
    );
    req.user = data.user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// POST / — naya payment create karo
router.post('/', authenticate, async (req, res) => {
  const {
    amount,
    currency       = 'USD',
    description,
    payment_method = 'card'
  } = req.body;

  if (!amount || amount <= 0)
    return res.status(400).json({ error: 'Valid amount required' });

  try {
    // 90% success rate simulate karo
    const status         = Math.random() > 0.1 ? 'completed' : 'failed';
    const transaction_id = generateTxnId();

    // MongoDB mein payment save karo
    const payment = await Payment.create({
      user_id:        req.user.id,
      amount,
      currency,
      status,
      description,
      payment_method,
      transaction_id
    });

    // Notification service ko async call karo — fire and forget
    // Agar fail bhi ho toh payment affect nahi hogi
    axios.post(NOTIF_URL + '/api/notify/send', {
      user_id: req.user.id,
      type:    'payment',
      subject: `Payment ${status}`,
      message: `Your payment of ${currency} ${amount} has ${status}. Txn: ${transaction_id}`,
      email:   req.user.email,
    }).catch(err => console.log('Notification failed (non-critical):', err.message));

    res.status(201).json({ message: `Payment ${status}`, payment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Payment failed' });
  }
});

// GET /my — sirf meri payments
router.get('/my', authenticate, async (req, res) => {
  try {
    const payments = await Payment
      .find({ user_id: req.user.id })
      .sort({ created_at: -1 });
    res.json({ payments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// GET / — saari payments (admin use)
router.get('/', authenticate, async (req, res) => {
  try {
    const payments = await Payment
      .find()
      .sort({ created_at: -1 })
      .limit(100);
    res.json({ payments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

module.exports = router;
