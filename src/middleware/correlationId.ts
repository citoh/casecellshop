import { RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const correlationId: RequestHandler = (req, res, next) => {
    req.headers['x-correlation-id'] = req.headers['x-correlation-id'] || uuidv4();
    next();
};
