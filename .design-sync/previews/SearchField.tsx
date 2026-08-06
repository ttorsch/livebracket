import { SearchField } from 'livebracket-ds';
import { useState } from 'react';

export function Default() {
  const [value, setValue] = useState('');
  return (
    <div style={{ padding: 20 }}>
      <SearchField
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search tournaments, locations, divisions"
      />
    </div>
  );
}

export function NoMic() {
  return (
    <div style={{ padding: 20 }}>
      <SearchField placeholder="Search" showMic={false} />
    </div>
  );
}
