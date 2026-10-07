// Мінімальна перевірка написання за словником Hunspell (.dic + .aff).
// Підтримує рівно те, що потрібно для наданих знімків hunspell-en та hunspell-uk:
// однорівневі SFX, PFX і їх перехресне поєднання. Складені слова (COMPOUNDRULE)
// не розгортаються — для навчального словника вони не потрібні.

// «^» не екрануємо: в умовах Hunspell він трапляється лише як заперечення класу [^..].
const REGEX_SPECIAL = /[\\$*+?()|{}]/g;

function conditionToRegExp(cond, anchorEnd) {
  if (cond === '.' || cond === '') return null;
  // У Hunspell умова — спрощений вираз: літери, «.» та класи [..] / [^..].
  const safe = cond.replace(REGEX_SPECIAL, '\\$&');
  return new RegExp(anchorEnd ? `${safe}$` : `^${safe}`, 'u');
}

export function parseAff(text) {
  const suffixes = new Map(); // add -> [{flag, strip, cond, cross}]
  const prefixes = new Map();
  const special = { noSuggest: null, onlyInCompound: null, needAffix: null, forbidden: null };
  const cross = new Map();

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    const kind = parts[0];
    if (kind === 'NOSUGGEST') special.noSuggest = parts[1];
    else if (kind === 'ONLYINCOMPOUND') special.onlyInCompound = parts[1];
    else if (kind === 'NEEDAFFIX') special.needAffix = parts[1];
    else if (kind === 'FORBIDDENWORD') special.forbidden = parts[1];
    if (kind !== 'SFX' && kind !== 'PFX') continue;

    const flag = parts[1];
    // Заголовок групи: «SFX flag Y 12».
    if (parts.length === 4 && (parts[2] === 'Y' || parts[2] === 'N') && /^\d+$/.test(parts[3])) {
      cross.set(`${kind}:${flag}`, parts[2] === 'Y');
      continue;
    }
    const strip = parts[2] === '0' ? '' : parts[2];
    const add = (parts[3] === '0' ? '' : parts[3]).split('/')[0];
    const cond = parts[4] ?? '.';
    const rule = {
      flag,
      strip,
      add,
      cond: conditionToRegExp(cond, kind === 'SFX'),
      cross: cross.get(`${kind}:${flag}`) ?? false,
    };
    const table = kind === 'SFX' ? suffixes : prefixes;
    if (!table.has(add)) table.set(add, []);
    table.get(add).push(rule);
  }
  return { suffixes, prefixes, special };
}

export function parseDic(text) {
  const entries = new Map(); // слово -> рядок прапорців
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].replace(/\r$/, '');
    if (!line) continue;
    const head = line.split(/[\t ]/)[0];
    const slash = head.indexOf('/');
    const word = slash === -1 ? head : head.slice(0, slash);
    const flags = slash === -1 ? '' : head.slice(slash + 1);
    if (!word) continue;
    entries.set(word, (entries.get(word) ?? '') + flags);
  }
  return entries;
}

export class Hunspell {
  constructor(affText, dicText) {
    this.aff = parseAff(affText);
    this.dic = parseDic(dicText);
  }

  #usable(flags) {
    const { onlyInCompound, forbidden } = this.aff.special;
    if (onlyInCompound && flags.includes(onlyInCompound)) return false;
    if (forbidden && flags.includes(forbidden)) return false;
    return true;
  }

  /** Чи позначено слово в словнику як NOSUGGEST (грубе/небажане). */
  isNoSuggest(word) {
    const flag = this.aff.special.noSuggest;
    if (!flag) return false;
    return (this.dic.get(word) ?? '').includes(flag);
  }

  #stemHas(stem, flag, extraFlag) {
    const flags = this.dic.get(stem);
    if (flags === undefined || !this.#usable(flags)) return false;
    if (!flags.includes(flag)) return false;
    return extraFlag ? flags.includes(extraFlag) : true;
  }

  #checkSuffix(word, extraFlag, requireCross) {
    const { suffixes } = this.aff;
    for (let i = 0; i <= word.length; i += 1) {
      const rules = suffixes.get(word.slice(i));
      if (!rules) continue;
      const base = word.slice(0, i);
      for (const rule of rules) {
        if (requireCross && !rule.cross) continue;
        const stem = base + rule.strip;
        if (!stem) continue;
        if (rule.cond && !rule.cond.test(stem)) continue;
        if (this.#stemHas(stem, rule.flag, extraFlag)) return true;
      }
    }
    return false;
  }

  /** Перевіряє слово точно в поданому регістрі (без підбору великої літери). */
  check(word) {
    const direct = this.dic.get(word);
    const { needAffix } = this.aff.special;
    if (direct !== undefined && this.#usable(direct) && !(needAffix && direct.includes(needAffix))) {
      return true;
    }
    if (this.#checkSuffix(word, null, false)) return true;

    for (const [add, rules] of this.aff.prefixes) {
      if (!word.startsWith(add)) continue;
      for (const rule of rules) {
        const stem = rule.strip + word.slice(add.length);
        if (!stem) continue;
        if (rule.cond && !rule.cond.test(stem)) continue;
        if (this.#stemHas(stem, rule.flag, null)) return true;
        if (rule.cross && this.#checkSuffix(stem, rule.flag, true)) return true;
      }
    }
    return false;
  }
}
