import { profileInput, type Profile, type ProfileInput } from '@app/contracts/profile';
import { useEffect } from 'react';
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { ApiError } from '../../../shared/api/client';
import { Banner, Button, Card, Field, Input, useToast } from '../../../shared/ui';
import { useSaveProfile } from '../api/hooks';
import { copy, fill } from '../copy';

export interface ProfileFormValues {
  businessName: string;
  description: string;
  category: string;
  website: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  deliveryRadiusMiles: string;
  currentCustomers: string;
  priceRange: string;
}

type Name = keyof ProfileFormValues;

/** Form field to the contract's request path, for mapping API and schema errors back. */
const paths: Record<Name, string> = {
  businessName: 'businessName',
  description: 'description',
  category: 'category',
  website: 'website',
  line1: 'address.line1',
  city: 'address.city',
  state: 'address.state',
  postalCode: 'address.postalCode',
  deliveryRadiusMiles: 'deliveryRadiusMiles',
  currentCustomers: 'currentCustomers',
  priceRange: 'priceRange',
};
const nameOfPath = (path: string) => (Object.keys(paths) as Name[]).find((n) => paths[n] === path);

const orNull = (s: string) => (s.trim() === '' ? null : s.trim());

export function toValues(p: Profile): ProfileFormValues {
  return {
    businessName: p.businessName,
    description: p.description ?? '',
    category: p.category ?? '',
    website: p.website ?? '',
    line1: p.address.line1 ?? '',
    city: p.address.city ?? '',
    state: p.address.state ?? '',
    postalCode: p.address.postalCode ?? '',
    deliveryRadiusMiles: p.deliveryRadiusMiles === null ? '' : String(p.deliveryRadiusMiles),
    currentCustomers: p.currentCustomers ?? '',
    priceRange: p.priceRange ?? '',
  };
}

export function toInput(v: ProfileFormValues): unknown {
  const radius = v.deliveryRadiusMiles.trim();
  return {
    businessName: v.businessName,
    description: orNull(v.description),
    category: orNull(v.category),
    website: orNull(v.website),
    address: {
      line1: orNull(v.line1),
      city: orNull(v.city),
      state: orNull(v.state),
      postalCode: orNull(v.postalCode),
      country: 'US',
    },
    deliveryRadiusMiles: radius === '' ? null : Number(radius),
    currentCustomers: orNull(v.currentCustomers),
    priceRange: orNull(v.priceRange),
  };
}

function message(path: string, issueMessage: string, code: string, maximum?: unknown): string {
  if (path === 'deliveryRadiusMiles') {
    return code === 'invalid_type' ? copy.number : copy.radiusRange;
  }
  if (path === 'website') return copy.websiteInvalid;
  if (code === 'too_small') return copy.required;
  if (code === 'too_big' && typeof maximum === 'number')
    return fill(copy.tooLong, { max: maximum });
  return issueMessage;
}

/** Validates with the contract schema (the form works in strings, the contract in null and numbers). */
const resolver: Resolver<ProfileFormValues> = (values) => {
  const result = profileInput.safeParse(toInput(values));
  if (result.success) return { values, errors: {} };
  const errors: FieldErrors<ProfileFormValues> = {};
  for (const issue of result.error.issues) {
    const name = nameOfPath(issue.path.join('.'));
    if (!name || errors[name]) continue;
    const maximum = 'maximum' in issue ? issue.maximum : undefined;
    errors[name] = {
      type: issue.code,
      message: message(issue.path.join('.'), issue.message, issue.code, maximum),
    };
  }
  return { values: {}, errors };
};

export function ProfileForm({ profile }: { profile: Profile }) {
  const toast = useToast();
  const save = useSaveProfile();
  const form = useForm<ProfileFormValues>({ defaultValues: toValues(profile), resolver });
  const { register, handleSubmit, reset, setError, formState } = form;
  const { errors } = formState;

  useEffect(() => reset(toValues(profile)), [profile, reset]);

  const onSubmit = handleSubmit((values) => {
    save.mutate(toInput(values) as ProfileInput, {
      onSuccess: () => toast({ message: copy.saved }),
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'VALIDATION_ERROR' && error.fields) {
          for (const [path, text] of Object.entries(error.fields)) {
            const name = nameOfPath(path);
            if (name) setError(name, { message: text });
          }
        } else if (error instanceof ApiError && error.code === 'ADDRESS_NOT_FOUND') {
          setError('line1', { message: copy.addressNotFound });
        }
      },
    });
  });

  const generic =
    save.isError &&
    !(
      save.error instanceof ApiError &&
      ['VALIDATION_ERROR', 'ADDRESS_NOT_FOUND'].includes(save.error.code)
    );

  const field = (name: Name, label: string, type = 'text', inputMode?: 'numeric') => (
    <Field label={label} error={errors[name]?.message}>
      {(props) => <Input type={type} inputMode={inputMode} {...props} {...register(name)} />}
    </Field>
  );

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">{copy.title}</h1>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {copy.save}
        </Button>
      </div>
      {generic && <Banner tone="warn">{copy.saveFailed}</Banner>}
      <Card className="flex flex-col gap-4">
        <h2 className="m-0 text-base font-semibold text-fg">{copy.business}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {field('businessName', copy.name)}
          {field('category', copy.category)}
          {field('description', copy.description)}
          {field('website', copy.website, 'url')}
        </div>
      </Card>
      <Card className="flex flex-col gap-4">
        <h2 className="m-0 text-base font-semibold text-fg">{copy.location}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {field('line1', copy.address)}
          {field('city', copy.city)}
          {field('state', copy.state)}
          {field('postalCode', copy.zip)}
          {field('deliveryRadiusMiles', copy.radius, 'text', 'numeric')}
        </div>
      </Card>
      <Card className="flex flex-col gap-4">
        <h2 className="m-0 text-base font-semibold text-fg">{copy.customers}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {field('currentCustomers', copy.currentCustomers)}
          {field('priceRange', copy.priceRange)}
        </div>
      </Card>
    </form>
  );
}
