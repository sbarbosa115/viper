import type { Contact } from '@app/contracts/leads';
import { contactTypeLabels, describeSource, websiteHref } from '../lib/format';
import { copy } from '../copy';
import { WithSource } from './source-note';

function valueNode(contact: Contact) {
  if (contact.type === 'phone') return <a href={`tel:${contact.value}`}>{contact.value}</a>;
  if (contact.type === 'email') return <a href={`mailto:${contact.value}`}>{contact.value}</a>;
  if (contact.type === 'website') {
    return (
      <a href={websiteHref(contact.value)} target="_blank" rel="noopener noreferrer">
        {contact.value}
      </a>
    );
  }
  return <>{contact.value}</>;
}

export function VerifiedMark({ verified }: { verified: boolean }) {
  return (
    <span className={verified ? 'text-accent' : 'text-muted'}>
      <span aria-hidden="true">{verified ? '●' : '○'}</span>{' '}
      {verified ? copy.verified : copy.unverified}
    </span>
  );
}

/** Compact contacts for the preview: value, Verified state, Source name. Source detail on focus. */
export function ContactList({ contacts }: { contacts: Contact[] }) {
  return (
    <ul aria-label={copy.contacts} className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
      {contacts.map((c) => (
        <li key={`${c.type}-${c.value}`} className="flex flex-wrap items-baseline gap-x-2">
          <span className="sr-only">{contactTypeLabels[c.type]}</span>
          <WithSource source={c.source}>{valueNode(c)}</WithSource>
          <span className="font-mono text-xs">
            <VerifiedMark verified={c.verification === 'verified'} />
          </span>
          <span className="text-[13px] text-muted">· {c.source.name}</span>
        </li>
      ))}
    </ul>
  );
}

/** The detail page's contacts table: Type, Value, Status, Source. */
export function ContactTable({ contacts }: { contacts: Contact[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">{copy.contacts}</caption>
      <thead>
        <tr className="text-left text-xs uppercase tracking-wider text-muted">
          <th scope="col" className="py-2 pr-3 font-medium">
            {copy.colType}
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            {copy.colValue}
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            {copy.colStatus}
          </th>
          <th scope="col" className="py-2 font-medium">
            {copy.colSource}
          </th>
        </tr>
      </thead>
      <tbody>
        {contacts.map((c) => (
          <tr key={`${c.type}-${c.value}`} className="border-t border-line">
            <th scope="row" className="py-2.5 pr-3 text-left font-normal text-muted">
              {contactTypeLabels[c.type]}
            </th>
            <td className="py-2.5 pr-3 text-fg">
              <WithSource source={c.source}>{valueNode(c)}</WithSource>
            </td>
            <td className="py-2.5 pr-3 font-mono text-xs">
              <VerifiedMark verified={c.verification === 'verified'} />
            </td>
            <td className="py-2.5 text-[13px] text-muted">{describeSource(c.source)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
