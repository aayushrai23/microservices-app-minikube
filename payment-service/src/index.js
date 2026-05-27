require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const paymentRoutes = require('./routes/payment');
const { connectDB } = require('./db');
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(morgan('dev'));
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'payment-service' }));
app.use('/api/payment', paymentRoutes);
const start = async () => {
  await connectDB();
  app.listen(process.env.PORT || 3002, () => console.log('Payment Service running on port 3002'));
};
start();
