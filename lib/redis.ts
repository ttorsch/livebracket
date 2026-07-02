import { Redis } from '@upstash/redis';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

let client: Redis | null = null;

function getRedis(): Redis {
  if (!redisUrl || !redisToken) {
    throw new Error(
      'Redis is not configured. Set UPSTASH_REDIS_REST_URL and ' +
        'UPSTASH_REDIS_REST_TOKEN in your environment (e.g. Vercel project settings).'
    );
  }
  if (!client) {
    client = new Redis({ url: redisUrl, token: redisToken });
  }
  return client;
}

// Lazy proxy, same rationale as lib/supabase.ts: importing this module must
// never throw during build/prerender when the env vars are absent — only
// the first real call at request time should fail if misconfigured.
export const redis: Redis = new Proxy({} as Redis, {
  get(_target, prop, receiver) {
    const target = getRedis();
    const value = Reflect.get(target, prop, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
