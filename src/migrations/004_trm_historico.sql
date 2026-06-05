CREATE TABLE IF NOT EXISTS trm_historico (
  fecha DATE PRIMARY KEY,
  valor NUMERIC(10,2) NOT NULL,
  fuente TEXT DEFAULT 'banrep',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE trm_historico DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_trm_historico_fecha ON trm_historico(fecha DESC);
