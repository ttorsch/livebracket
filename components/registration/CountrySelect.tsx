'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { COUNTRIES } from '@/lib/countries';
import styles from './CountrySelect.module.css';

/* Type-to-search country picker.
 *
 * A plain <select> over 260 countries means scrolling to Thailand. This
 * filters as you type while still refusing anything that is not on the
 * list — the answer lands in players.custom_fields and is read back by
 * the organizer's roster and CSV export, so a free-text "Thailnad" would
 * quietly become a country of one.
 *
 * Not a <datalist>: it does not constrain the value, and Safari's
 * rendering of it is a different control from Chrome's. */

/* "Aland" should find "Åland Islands", and "cote" should find
 * "Côte d'Ivoire" — nobody reaches for the diacritic while typing. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function CountrySelect({ value, onChange, placeholder = 'Search countries…' }: Props) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return COUNTRIES;
    /* Names starting with the query first — typing "ind" should offer
     * India before British Indian Ocean Territory. */
    const starts: string[] = [];
    const contains: string[] = [];
    for (const country of COUNTRIES) {
      const folded = fold(country);
      if (folded.startsWith(q)) starts.push(country);
      else if (folded.includes(q)) contains.push(country);
    }
    return [...starts, ...contains];
  }, [query]);

  const openList = () => {
    setOpen(true);
    setQuery('');
    setActive(Math.max(0, COUNTRIES.indexOf(value)));
  };

  const close = () => {
    setOpen(false);
    setQuery('');
    setActive(0);
  };

  const choose = (country: string) => {
    onChange(country);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault();
      openList();
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(i => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[active]) choose(matches[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    <div
      className={styles.wrap}
      ref={wrapRef}
      /* Closing on blur rather than a document listener: the only way out
       * of this control is to leave it, and relatedTarget tells us whether
       * focus went to one of our own options. */
      onBlur={e => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        className={styles.input}
        placeholder={open ? placeholder : 'Select a country'}
        /* Closed, the field shows the answer; open, it shows what is being
         * typed. Two jobs, one box — which is what a combobox is. */
        value={open ? query : value}
        onChange={e => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true); }}
        onFocus={openList}
        onKeyDown={onKeyDown}
      />
      <ChevronDown size={15} className={styles.chevron} aria-hidden="true" />

      {open && (
        <ul className={styles.list} id={listId} role="listbox">
          {matches.length === 0 && <li className={styles.empty}>No country matches that</li>}
          {matches.map((country, i) => (
            <li key={country}>
              <button
                type="button"
                id={`${listId}-${i}`}
                role="option"
                aria-selected={country === value}
                className={`${styles.option} ${i === active ? styles.optionActive : ''} ${country === value ? styles.optionChosen : ''}`}
                /* mousedown, not click: the blur handler above would close
                 * the list before a click ever landed. */
                onMouseDown={e => { e.preventDefault(); choose(country); }}
                onMouseEnter={() => setActive(i)}
              >
                {country}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
