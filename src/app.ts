import express from 'express';
import { correlationId } from './middleware/correlationId';
import productsRoutes from './routes/products.routes';
import checkoutRoutes from './routes/checkout.routes';
import ordersRoutes from './routes/orders.routes';
import metricsRoutes from './routes/metrics.routes';
import './queue/worker'; // registra o consumidor da fila (efeito colateral)

const app = express();
app.use(express.json());
app.use(correlationId);

app.use(productsRoutes);
app.use(checkoutRoutes);
app.use(ordersRoutes);
app.use(metricsRoutes);

export default app;
