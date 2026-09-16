'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { getCountries, getCountryCallingCode } from 'libphonenumber-js/min';
import styles from './CountryCodeSelect.module.css';

interface CallingCodeOption {
  country: string;
  code: string;
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const CALLING_CODES: readonly CallingCodeOption[] = getCountries()
  .map(country => ({
    country: regionNames.of(country) ?? country,
    code: getCountryCallingCode(country),
  }))
  .sort((a, b) => a.country.localeCompare(b.country));

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export default function CountryCodeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const q = fold(query.trim()).replace(/^\+/, '');
    if (!q) return CALLING_CODES;
    return CALLING_CODES.filter(option =>
      fold(option.country).includes(q) || option.code.includes(q),
    );
  }, [query]);

  const openList = () => {
    setOpen(true);
    setQuery('');
    setActive(Math.max(0, CALLING_CODES.findIndex(option => option.code === value)));
  };

  const close = () => {
    setOpen(false);
    setQuery('');
    setActive(0);
  };

  const choose = (option: CallingCodeOption) => {
    onChange(option.code);
    close();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open && (event.key === 'ArrowDown' || event.key === 'Enter')) {
      event.preventDefault();
      openList();
      return;
    }
    if (!open) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(index => Math.min(index + 1, matches.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(index => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (matches[active]) choose(matches[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  return (
    <div
      className={styles.wrap}
      ref={wrapRef}
      onBlur={event => {
        if (!wrapRef.current?.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <input
        type="text"
        role="combobox"
        aria-label="Country code"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        className={styles.input}
        placeholder={open ? 'Search country or code…' : 'Country code'}
        value={open ? query : value ? `+${value}` : ''}
        onChange={event => {
          setQuery(event.target.value);
          setActive(0);
          if (!open) setOpen(true);
        }}
        onFocus={openList}
        onKeyDown={onKeyDown}
      />
      <ChevronDown size={15} className={styles.chevron} aria-hidden="true" />

      {open && (
        <ul className={styles.list} id={listId} role="listbox">
          {matches.length === 0 && <li className={styles.empty}>No country or code matches</li>}
          {matches.map((option, index) => (
            <li key={option.country}>
              <button
                type="button"
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.code === value}
                className={`${styles.option} ${index === active ? styles.optionActive : ''} ${option.code === value ? styles.optionChosen : ''}`}
                onMouseDown={event => { event.preventDefault(); choose(option); }}
                onMouseEnter={() => setActive(index)}
              >
                {option.country} (+{option.code})
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
