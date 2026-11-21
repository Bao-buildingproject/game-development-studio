import { createGameServer } from './server';

const PORT = Number(process.env.PORT ?? 2567);
const prod = process.env.NODE_ENV === 'production';
createGameServer(PORT, prod ? 'prod' : 'dev')
  .then(() => console.log(`IT LEARNS server on http://localhost:${PORT} (${prod ? 'production' : 'development'})`))
  .catch((e) => { console.error(e); process.exit(1); });
