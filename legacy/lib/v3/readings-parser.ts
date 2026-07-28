/**
 * Parseur de relevés quantitatifs/qualitatifs depuis texte d'observation FR.
 */
export type ParsedReading =
  | { quantity_id: string; value: number; unit: string; status: 'parsed' }
  | { quantity_id: string; modality: string; status: 'qualitative_mapped' };

export type ParseResult = {
  readings: ParsedReading[];
  status: 'parsed' | 'qualitative_mapped' | 'unparseable';
};

const NUMERIC_PATTERNS: Array<{
  re: RegExp;
  quantity_id: string;
  unit: string;
  scale?: number;
}> = [
  { re: /ΔT\s*[=:]\s*([0-9]+(?:[.,][0-9]+)?)\s*K/i, quantity_id: 'delta_t_eau', unit: 'K' },
  { re: /delta\s*t\s*[=:]\s*([0-9]+(?:[.,][0-9]+)?)\s*K/i, quantity_id: 'delta_t_eau', unit: 'K' },
  { re: /([0-9]+(?:[.,][0-9]+)?)\s*bar/i, quantity_id: 'pression_circuit_bar', unit: 'bar' },
  { re: /([0-9]+(?:[.,][0-9]+)?)\s*l\s*\/\s*min/i, quantity_id: 'debit_l_min', unit: 'l/min' },
  { re: /([0-9]+(?:[.,][0-9]+)?)\s*A\b/i, quantity_id: 'amperage_circulateur', unit: 'A' },
  { re: /HP\s*[=:]\s*([0-9]+(?:[.,][0-9]+)?)/i, quantity_id: 'hp_bar', unit: 'bar' },
  { re: /BP\s*[=:]\s*([0-9]+(?:[.,][0-9]+)?)/i, quantity_id: 'bp_bar', unit: 'bar' },
  { re: /([0-9]+(?:[.,][0-9]+)?)\s*°C/i, quantity_id: 't_depart', unit: '°C' },
  { re: /([0-9]+(?:[.,][0-9]+)?)\s*K\b/i, quantity_id: 'delta_t_eau', unit: 'K' },
];

const QUALITATIVE_MAP: Array<{ re: RegExp; quantity_id: string; modality: string }> = [
  { re: /purgeur.*(crache|évacue|air)/i, quantity_id: 'purgeur', modality: 'crache_air' },
  { re: /purgeur.*(sec|pas d.?air)/i, quantity_id: 'purgeur', modality: 'sec' },
  { re: /(raclement|claquement|gripp)/i, quantity_id: 'bruit_pompe', modality: 'claquement' },
  { re: /cavitation/i, quantity_id: 'bruit_pompe', modality: 'cavitation' },
  { re: /(silencieux|pas de bruit)/i, quantity_id: 'bruit_pompe', modality: 'silencieux' },
  { re: /givre.*(général|partout)/i, quantity_id: 'givre', modality: 'generalise' },
  { re: /givre.*(local|partiel)/i, quantity_id: 'givre', modality: 'localise' },
  { re: /(pas de givre|sans givre)/i, quantity_id: 'givre', modality: 'absent' },
  { re: /condensat.*(bouch|obstru)/i, quantity_id: 'condensats', modality: 'bouche' },
  { re: /fuite.*(présent|visible)/i, quantity_id: 'fuite_visible', modality: 'present' },
  { re: /(pas de fuite|aucune fuite)/i, quantity_id: 'fuite_visible', modality: 'absent' },
  { re: /vanne.*ferm/i, quantity_id: 'vanne_position', modality: 'fermee' },
  { re: /bypass.*(ferm|non ouvert)/i, quantity_id: 'bypass_ouvert', modality: 'non' },
  { re: /(beaucoup d.?air|air\s+[ée]vacu)/i, quantity_id: 'purgeur', modality: 'crache_air' },
  { re: /(peu d.?air|pas d.?air)/i, quantity_id: 'purgeur', modality: 'sec' },
  { re: /(tamis|filtre).*(propre|nettoy)/i, quantity_id: 'debit_l_min', modality: 'normal' },
  { re: /purgeur.*bouch/i, quantity_id: 'purgeur', modality: 'crache_air' },
  { re: /(arbre libre|conforme|mécaniquement ok)/i, quantity_id: 'bruit_pompe', modality: 'silencieux' },
  { re: /(défaut|7H).*(dispara|plus)/i, quantity_id: 'led_defaut', modality: 'absent' },
  { re: /bypass.*(ouvert|regl)/i, quantity_id: 'bypass_ouvert', modality: 'oui' },
  { re: /ΔT.*(quasi nul|faible|très faible|bas)/i, quantity_id: 'delta_t_eau', modality: 'low' },
  { re: /vanne.*(bloqu|ecs|3 voies)/i, quantity_id: 'vanne_position', modality: 'fermee' },
  { re: /flowswitch.*(conforme|inutile)/i, quantity_id: 'debit_l_min', modality: 'normal' },
  { re: /pression.*stable/i, quantity_id: 'pression_circuit_bar', modality: 'in_range' },
  { re: /(débit|debit).*(remonte|reprend|ok)/i, quantity_id: 'debit_l_min', modality: 'normal' },
  { re: /code\s+([A-Z0-9][A-Z0-9.\-]{0,8})/i, quantity_id: 'led_defaut', modality: 'code' },
];

function parseNumber(raw: string): number {
  return Number(raw.replace(',', '.'));
}

export function parseObservationText(text: string, actionId?: string): ParseResult {
  const readings: ParsedReading[] = [];
  const seen = new Set<string>();

  for (const p of NUMERIC_PATTERNS) {
    const m = text.match(p.re);
    if (!m?.[1]) continue;
    const key = `${p.quantity_id}:${m[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    readings.push({
      quantity_id: p.quantity_id,
      value: parseNumber(m[1]) * (p.scale ?? 1),
      unit: p.unit,
      status: 'parsed',
    });
  }

  for (const q of QUALITATIVE_MAP) {
    if (!q.re.test(text)) continue;
    const key = `q:${q.quantity_id}:${q.modality}`;
    if (seen.has(key)) continue;
    seen.add(key);
    readings.push({
      quantity_id: q.quantity_id,
      modality: q.modality,
      status: 'qualitative_mapped',
    });
  }

  if (actionId) {
    for (const r of inferFromAction(actionId, text)) {
      const key = `a:${r.quantity_id}:${r.modality ?? r.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      readings.push(r);
    }
  }

  if (readings.length === 0) return { readings: [], status: 'unparseable' };
  const hasNumeric = readings.some((r) => r.status === 'parsed');
  return {
    readings,
    status: hasNumeric ? 'parsed' : 'qualitative_mapped',
  };
}

function inferFromAction(actionId: string, text: string): ParsedReading[] {
  const t = text.toLowerCase();
  const out: ParsedReading[] = [];

  if (actionId === 'MAN-PURGE') {
    if (/air|purge|evacu/.test(t)) {
      out.push({ quantity_id: 'purgeur', modality: 'crache_air', status: 'qualitative_mapped' });
    }
    if (/dispara|plus de 7h|7h dispar/.test(t)) {
      out.push({ quantity_id: 'led_defaut', modality: 'absent', status: 'qualitative_mapped' });
    }
    if (/peu d.?air|pas d.?amélioration|stable/.test(t)) {
      out.push({ quantity_id: 'purgeur', modality: 'sec', status: 'qualitative_mapped' });
    }
  }
  if (actionId === 'OBS-PURGEUR' && /bouch|encrass|pas de purge/.test(t)) {
    out.push({ quantity_id: 'purgeur', modality: 'crache_air', status: 'qualitative_mapped' });
  }
  if (actionId === 'DEM-FILTRE' && /(propre|nettoy|ok)/.test(t)) {
    out.push({ quantity_id: 'debit_l_min', modality: 'normal', status: 'qualitative_mapped' });
  }
  if (actionId.startsWith('REM-CIRCULATEUR') || actionId === 'REM-CIRCULATEUR') {
    if (/libre|conforme|ok|aucun effet/.test(t)) {
      out.push({ quantity_id: 'bruit_pompe', modality: 'silencieux', status: 'qualitative_mapped' });
    }
    if (/résolu|resolu|remplac/.test(t)) {
      out.push({ quantity_id: 'debit_l_min', modality: 'normal', status: 'qualitative_mapped' });
    }
  }
  if (actionId === 'MAN-REGLAGE-BYPASS' && /(ouvert|débit|debit|dispara)/.test(t)) {
    out.push({ quantity_id: 'bypass_ouvert', modality: 'oui', status: 'qualitative_mapped' });
  }
  if (actionId === 'MAN-REMPLISSAGE' && /(bar|pression|1[.,]5)/.test(t)) {
    const m = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*bar/);
    if (m) {
      out.push({
        quantity_id: 'pression_circuit_bar',
        value: parseNumber(m[1]!),
        unit: 'bar',
        status: 'parsed',
      });
    } else {
      out.push({ quantity_id: 'pression_circuit_bar', modality: 'in_range', status: 'qualitative_mapped' });
    }
  }
  if (actionId === 'REM-FLOWSWITCH' && /(conforme|inutile|wrong)/.test(t)) {
    out.push({ quantity_id: 'debit_l_min', modality: 'normal', status: 'qualitative_mapped' });
  }
  if (actionId === 'OBS-VANNE' && /vanne|bloqu|ecs|chauff/.test(t)) {
    out.push({ quantity_id: 'vanne_position', modality: 'fermee', status: 'qualitative_mapped' });
  }
  if (actionId === 'MES-DT-EAU' && /(quasi nul|faible|très faible|bas)/i.test(text)) {
    out.push({ quantity_id: 'delta_t_eau', modality: 'low', status: 'qualitative_mapped' });
  }
  if (actionId === 'MAN-FORCAGE-VENTILO' && /(reprend|débit|debit|ok)/.test(t)) {
    out.push({ quantity_id: 'vanne_position', modality: 'ouverte', status: 'qualitative_mapped' });
  }

  return out;
}

export function parseCombinedText(...parts: Array<string | undefined | null>): ParseResult {
  const text = parts.filter(Boolean).join(' — ');
  return parseObservationText(text);
}
