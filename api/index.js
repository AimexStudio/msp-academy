// Every /api/... request on Vercel arrives here (see vercel.json).
import { createVercelHandler, getVercelApp } from '../src/vercel.js';
export default createVercelHandler(getVercelApp);
