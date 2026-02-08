import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt, StrategyOptions } from 'passport-jwt';
import { prisma } from './db';
import type { TokenPayload } from '@mailhub/shared';

export function configurePassport(): void {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        throw new Error('JWT_SECRET environment variable is not set');
    }

    const options: StrategyOptions = {
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        secretOrKey: jwtSecret,
    };

    passport.use(
        new JwtStrategy(options, async (payload: TokenPayload, done) => {
            try {
                const user = await prisma.user.findUnique({
                    where: { id: payload.userId },
                    select: {
                        id: true,
                        email: true,
                        displayName: true,
                        isActive: true,
                    },
                });

                if (!user || !user.isActive) {
                    return done(null, false);
                }

                return done(null, user);
            } catch (error) {
                return done(error, false);
            }
        })
    );
}
