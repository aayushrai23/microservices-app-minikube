const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { User } = require('../db');
const { generateToken, verifyToken } = require('../middleware/auth');
const router = express.Router();

// Register — naya user banao
router.post('/register', [
  body('name').notEmpty(),
  body('email').isEmail(),
  body('password').isLength({ min: 6 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ errors: errors.array() });

  const { name, email, password } = req.body;
  try {
    // Check karo email pehle se registered hai ya nahi
    const exists = await User.findOne({ email });
    if (exists)
      return res.status(409).json({ error: 'Email already registered' });

    // Password hash karo — kabhi plain text store nahi karte
    const hashed = await bcrypt.hash(password, 12);

    // User MongoDB mein save karo
    const user = await User.create({ name, email, password: hashed });

    // JWT token banao
    const token = generateToken({
      id:    user._id,
      email: user.email,
      role:  user.role
    });

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id:    user._id,
        name:  user.name,
        email: user.email,
        role:  user.role
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login — existing user authenticate karo
router.post('/login', [
  body('email').isEmail(),
  body('password').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ errors: errors.array() });

  const { email, password } = req.body;
  try {
    // Email se user dhundo
    const user = await User.findOne({ email });
    if (!user)
      return res.status(401).json({ error: 'Invalid credentials' });

    // Password verify karo
    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(401).json({ error: 'Invalid credentials' });

    const token = generateToken({
      id:    user._id,
      email: user.email,
      role:  user.role
    });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id:    user._id,
        name:  user.name,
        email: user.email,
        role:  user.role
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Me — current logged in user ki info
router.get('/me', verifyToken, async (req, res) => {
  try {
    // .select('-password') — password field return mat karo
    const user = await User.findById(req.user.id).select('-password');
    if (!user)
      return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Verify — doosri services is route se token verify karti hain
router.post('/verify', verifyToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

module.exports = router;
