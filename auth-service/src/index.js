require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const authRoutes = require('./routes/auth');
const { connectDB } = require('./db');
const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(morgan('dev'));
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'auth-service' }));
app.use('/api/auth', authRoutes);
const start = async () => {
  await connectDB();
  app.listen(PORT, () => console.log('Auth Service running on port ' + PORT));
};
start();
