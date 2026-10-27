// Límite de intentos en memoria para frenar a quien prueba contraseñas una y otra vez.

function createLimiter({ max, windowMs }) {
  const hits = new Map();

  const entry = (key) => {
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.reset <= now) {
      e = { count: 0, reset: now + windowMs };
      hits.set(key, e);
    }
    if (hits.size > 10000) {
      for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    }
    return e;
  };

  return {
    blocked: (key) => entry(key).count >= max,
    hit: (key) => {
      entry(key).count++;
    },
    reset: (key) => {
      hits.delete(key);
    },
  };
}

module.exports = { createLimiter };
