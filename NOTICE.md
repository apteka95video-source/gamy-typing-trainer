# Ліцензії та атрибуція

| Частина репозиторію | Ліцензія | Власник прав |
|---|---|---|
| Код: `src/`, `scripts/`, `tests/`, `index.html`, `assets/`, `sw.js` | MIT — [LICENSE](LICENSE) | автори проєкту «Гами» |
| `data/filters/` | MIT | автори проєкту «Гами» |
| `data/texts/` | CC0-1.0 (суспільне надбання) | автори проєкту «Гами» |
| `data/derived/en/`, `data/curriculum/en.json` | MIT | похідні від FrequencyWords і Hunspell English |
| `data/derived/uk/`, `data/curriculum/uk.json` | GPL-3.0-or-later | похідні від FrequencyWords і dict_uk |
| `dictionaries/*/frequencywords-2018/` | MIT — файл `LICENSE` у каталозі | © 2016 Hermit Dave |
| `dictionaries/en/hunspell-en/` | MIT (пакування) і ліцензія SCOWL — файли `LICENSE`, `PACKAGE-LICENSE-MIT` | Kevin Atkinson та інші (SCOWL); Titus Wormer (пакування) |
| `dictionaries/uk/hunspell-uk/` | GPL-3.0 — файл `LICENSE` | спільнота brown-uk (dict_uk); Titus Wormer (пакування) |

## Джерела

- FrequencyWords — https://github.com/hermitdave/FrequencyWords, ревізія `525f9b560de45753a5ea01069454e72e9aa541c6`.
  Частотні списки зібрано на основі корпусу субтитрів OpenSubtitles 2018.
- wooorm/dictionaries — https://github.com/wooorm/dictionaries, ревізія `8cfea406b505e4d7df52d5a19bce525df98c54ab`.
- SCOWL — http://wordlist.aspell.net/
- brown-uk/dict_uk — https://github.com/brown-uk/dict_uk

## Про GPL

Український список слів відбирається за словником dict_uk (GPL-3.0), тому українські похідні дані
поширюються під GPL-3.0-or-later. Повний текст ліцензії — `dictionaries/uk/hunspell-uk/LICENSE`.
Ці дані лежать в окремих файлах; застосунок завантажує їх як дані й не вбудовує в код.
Скрипти, які відтворюють ці файли із сировини, є в репозиторії: `npm run build:data`.

Оригінальні файли джерел зберігаються без змін; їхні контрольні суми — у `dictionaries/manifest.json`.
