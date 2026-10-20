import type {Request, Response, NextFunction} from 'express';
import jwt from 'jsonwebtoken';

const jwtSecret: string = process.env.JWT_SECRET ?? '';

if (!jwtSecret) {
    throw new Error('JWT_SECRET is not defined');
}

interface JwtPayload {
    userId: string;
}

export interface AuthRequest extends Request {
    userId?: string;
}

export function authMiddleware(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
) {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
        return res.status(401).json({
            message: 'Требуется авторизация',
        });
    }

    const token = authorization.slice(7);

    try {
        const payload = jwt.verify(token, jwtSecret);

        if (
            typeof payload === 'string' ||
            typeof payload.userId !== 'string'
        ) {
            return res.status(401).json({
                message: 'Недействительный токен',
            });
        }

        req.userId = payload.userId;

        next();
    } catch {
        return res.status(401).json({
            message: 'Недействительный или просроченный токен',
        });
    }
}
