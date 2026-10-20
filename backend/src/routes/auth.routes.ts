import {Router} from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import {prisma} from '../lib/prisma.js';
import {
    loginSchema,
    registerSchema,
} from '../schemas/auth.schema.js';
import {authMiddleware, AuthRequest} from "../middleware/auth.middleware.js";

const router = Router();

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
    throw new Error('JWT_SECRET is not defined');
}

router.post('/register', async (req, res) => {
    const validation = registerSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({
            message: 'Некорректные данные регистрации',
            errors: validation.error.issues.map((issue) => ({
                field: issue.path.join('.'),
                message: issue.message,
            })),
        });
    }

    const {name, email, password} = validation.data;

    try {
        const existingUser = await prisma.user.findUnique({
            where: {email},
        });

        if (existingUser) {
            return res.status(409).json({
                message: 'Пользователь с таким email уже существует',
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const user = await prisma.user.create({
            data: {
                name,
                email,
                passwordHash,
            },
            select: {
                id: true,
                name: true,
                email: true,
            },
        });

        const token = jwt.sign(
            {userId: user.id},
            jwtSecret,
            {expiresIn: '7d'},
        );

        return res.status(201).json({
            message: 'Регистрация прошла успешно',
            user,
            token,
        });
    } catch (error) {
        console.error('Registration error:', error);

        return res.status(500).json({
            message: 'Не удалось зарегистрировать пользователя',
        });
    }
});

router.post('/login', async (req, res) => {
    const validation = loginSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({
            message: 'Некорректные данные для входа',
            errors: validation.error.issues.map((issue) => ({
                field: issue.path.join('.'),
                message: issue.message,
            })),
        });
    }

    const {email, password} = validation.data;

    try {
        const user = await prisma.user.findUnique({
            where: {email},
        });

        if (!user) {
            return res.status(401).json({
                message: 'Неверный email или пароль',
            });
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.passwordHash,
        );

        if (!passwordMatches) {
            return res.status(401).json({
                message: 'Неверный email или пароль',
            });
        }

        const token = jwt.sign(
            {userId: user.id},
            jwtSecret,
            {expiresIn: '7d'},
        );

        return res.json({
            message: 'Вход выполнен успешно',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
            },
            token,
        });
    } catch (error) {
        console.error('Login error:', error);

        return res.status(500).json({
            message: 'Не удалось выполнить вход',
        });
    }
});

router.get('/me', authMiddleware, async (req, res) => {
    const authReq = req as AuthRequest;

    try {
        const user = await prisma.user.findUnique({
            where: { id: authReq.userId },
            select: {
                id: true,
                name: true,
                email: true,
            },
        });

        if (!user) {
            return res.status(401).json({
                message: 'Пользователь не найден',
            });
        }

        return res.json({ user });
    } catch (error) {
        console.error('Get current user error:', error);

        return res.status(500).json({
            message: 'Не удалось получить данные пользователя',
        });
    }
});

export default router;
