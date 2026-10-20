import {z} from 'zod';

export const registerSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, 'Имя обязательно'),

    email: z
        .string()
        .trim()
        .pipe(z.email('Некорректный формат email'))
        .transform((email) => email.toLowerCase()),

    password: z
        .string()
        .min(8, 'Пароль должен содержать минимум 8 символов'),
});

export const loginSchema = z.object({
    email: z
        .string()
        .trim()
        .pipe(z.email('Некорректный формат email'))
        .transform((email) => email.toLowerCase()),

    password: z
        .string()
        .min(1, 'Пароль обязателен'),
});