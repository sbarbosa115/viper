import type { Product } from '@app/contracts/profile';
import type { TargetSegmentInput } from '@app/contracts/planning';
import { Button, Card, Field, Input, Select } from '../../../shared/ui';
import { copy, fill } from '../copy';
import { ChipEditor } from './chip-editor';

export const MAX_SEGMENTS = 5;

export interface SegmentsEditorProps {
  segments: TargetSegmentInput[];
  products: Product[];
  /** The error message for a field of a segment, from the form. */
  messageOf: (
    index: number,
    key: 'name' | 'productId' | 'fitSignals' | 'exclusions',
  ) => string | undefined;
  onChange: (segments: TargetSegmentInput[]) => void;
}

/** FR-17: Target segments as cards (1 to 5). */
export function SegmentsEditor({ segments, products, messageOf, onChange }: SegmentsEditorProps) {
  const update = (index: number, patch: Partial<TargetSegmentInput>) =>
    onChange(segments.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  return (
    <section aria-labelledby="plan-segments" className="flex flex-col gap-4">
      <h2 id="plan-segments" className="m-0 text-base font-semibold text-fg">
        {segments.length === 1 ? copy.whoToFindOne : fill(copy.whoToFind, { n: segments.length })}
      </h2>
      {segments.map((segment, i) => {
        const n = i + 1;
        return (
          <Card key={segment.id ?? `new-${i}`} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1">
                <Field label={fill(copy.segmentName, { n })} error={messageOf(i, 'name')}>
                  {(props) => (
                    <Input
                      {...props}
                      value={segment.name}
                      maxLength={60}
                      onChange={(e) => update(i, { name: e.target.value })}
                    />
                  )}
                </Field>
              </div>
              <div className="min-w-48">
                <Field label={fill(copy.segmentPitch, { n })} error={messageOf(i, 'productId')}>
                  {(props) => (
                    <Select
                      {...props}
                      value={segment.productId}
                      onChange={(e) => update(i, { productId: e.target.value })}
                    >
                      {segment.productId === '' && <option value="" />}
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <Button
                variant="danger-text"
                disabled={segments.length <= 1}
                onClick={() => onChange(segments.filter((_, j) => j !== i))}
              >
                {fill(copy.removeSegment, { n })}
              </Button>
            </div>
            <ChipEditor
              label={copy.fitSignals}
              addLabel={fill(copy.addFitSignal, { n })}
              values={segment.fitSignals}
              max={6}
              error={messageOf(i, 'fitSignals')}
              onChange={(fitSignals) => update(i, { fitSignals })}
            />
            <ChipEditor
              label={copy.skip}
              addLabel={fill(copy.addExclusion, { n })}
              values={segment.exclusions}
              max={5}
              error={messageOf(i, 'exclusions')}
              onChange={(exclusions) => update(i, { exclusions })}
            />
          </Card>
        );
      })}
      <div>
        <Button
          disabled={segments.length >= MAX_SEGMENTS}
          onClick={() =>
            onChange([
              ...segments,
              { name: '', fitSignals: [], exclusions: [], productId: products[0]?.id ?? '' },
            ])
          }
        >
          {copy.addSegment}
        </Button>
      </div>
    </section>
  );
}
