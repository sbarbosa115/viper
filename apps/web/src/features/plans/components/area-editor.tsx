import type { Place } from '@app/contracts/planning';
import { useState } from 'react';
import { Button, Card, Field, Input } from '../../../shared/ui';
import { useSearchPlaces } from '../api/hooks';
import { copy, fill } from '../copy';
import { MapPreview } from './map-preview';

export interface AreaValue {
  label: string;
  lat: number;
  lng: number;
  radiusMiles: number;
}

export interface AreaEditorProps {
  value: AreaValue;
  radiusError?: string | undefined;
  areaError?: string | undefined;
  onChange: (value: AreaValue) => void;
}

const MIN = 1;
const MAX = 25;

/** FR-17: place search, radius slider (1 to 25 miles) and a map preview. */
export function AreaEditor({ value, radiusError, areaError, onChange }: AreaEditorProps) {
  const [query, setQuery] = useState('');
  const search = useSearchPlaces();
  const run = () => {
    const q = query.trim();
    if (q.length >= 2) search.mutate(q);
  };
  const pick = (place: Place) => {
    onChange({ ...value, label: place.label, lat: place.lat, lng: place.lng });
    search.reset();
    setQuery('');
  };
  const radius = Number.isNaN(value.radiusMiles) ? MIN : value.radiusMiles;
  const mapRadius = Math.min(MAX, Math.max(MIN, radius));

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="m-0 text-base font-semibold text-fg">{copy.searchArea}</h2>
      <p className="m-0 text-sm text-fg-2">{fill(copy.areaCentre, { label: value.label })}</p>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label={copy.searchPlace} error={areaError}>
            {(props) => (
              <Input
                {...props}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    run();
                  }
                }}
              />
            )}
          </Field>
        </div>
        <Button loading={search.isPending} onClick={run}>
          {copy.searchPlaceButton}
        </Button>
      </div>
      {search.isError && (
        <p role="alert" className="m-0 text-sm text-danger">
          {copy.searchFailed}
        </p>
      )}
      {search.isSuccess &&
        (search.data.items.length === 0 ? (
          <p role="status" className="m-0 text-sm text-muted">
            {copy.noPlaces}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Places">
            {search.data.items.map((p) => (
              <li key={`${p.lat},${p.lng},${p.label}`}>
                <button
                  type="button"
                  onClick={() => pick(p)}
                  className="w-full rounded-row px-3 py-2 text-left text-sm text-fg-2 hover:bg-raised"
                >
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
        ))}
      <MapPreview lat={value.lat} lng={value.lng} radiusMiles={mapRadius} label={value.label} />
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-48 flex-1">
          <label htmlFor="radius-slider" className="mb-1.5 block text-[13px] font-medium text-fg">
            {copy.radiusSlider}
          </label>
          <input
            id="radius-slider"
            type="range"
            min={MIN}
            max={MAX}
            step={1}
            value={mapRadius}
            onChange={(e) => onChange({ ...value, radiusMiles: Number(e.target.value) })}
            className="w-full accent-accent"
          />
        </div>
        <div className="w-36">
          <Field label={copy.radius} error={radiusError}>
            {(props) => (
              <Input
                {...props}
                type="number"
                inputMode="numeric"
                value={Number.isNaN(value.radiusMiles) ? '' : value.radiusMiles}
                onChange={(e) =>
                  onChange({
                    ...value,
                    radiusMiles: e.target.value === '' ? Number.NaN : Number(e.target.value),
                  })
                }
              />
            )}
          </Field>
        </div>
      </div>
    </Card>
  );
}
