import { SegmentedControl, Icon } from 'livebracket-ds';
import { useState } from 'react';

export function Default() {
  const [tab, setTab] = useState('Latest');
  return (
    <div style={{ padding: 20 }}>
      <SegmentedControl
        value={tab}
        onChange={setTab}
        options={['Latest', 'Starting Soon', { label: 'Add Favorite', value: 'fav', icon: <Icon name="star" size={18} /> }]}
      />
    </div>
  );
}
