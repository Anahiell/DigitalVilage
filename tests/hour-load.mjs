// Run the HTTP load scenario with new workshop rules and one-second polling.
process.env.DV_LOAD_HOUR='1';
await import('./load.mjs');
