import { ids } from '@app/contracts/examples';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, test } from 'vitest';
import { server } from '../../../test/setup';
import { profileState, resetProfileState } from './handlers';
import { renderProfile } from './render';

beforeEach(resetProfileState);

describe('FR-15: edit the Business Profile by hand', () => {
  test('shows every profile field and the Product list while loading shows a skeleton', async () => {
    server.use(
      http.get('*/api/profile', async () => {
        await delay(60);
        return HttpResponse.json(profileState.profile);
      }),
    );
    renderProfile();
    expect(await screen.findByRole('status', { name: 'Loading profile' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Business Profile' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Sweet Supply Co');
    expect(screen.getByLabelText('Address')).toHaveValue('100 Congress Ave');
    expect(screen.getByLabelText('City')).toHaveValue('Austin');
    expect(screen.getByLabelText('Delivery radius (mi)')).toHaveValue('3');
    expect(screen.getByLabelText('Current customers')).toHaveValue('Restaurants');
    expect(screen.getByLabelText('Website')).toHaveValue('https://sweetsupply.example');
    const table = screen.getByRole('table', { name: 'Products' });
    expect(within(table).getByText('Cane sugar, 50 lb')).toBeInTheDocument();
  });

  test('saving sends the contract body, with empty fields as null, and confirms', async () => {
    renderProfile();
    const price = await screen.findByLabelText('Price range');
    await userEvent.clear(price);
    await userEvent.clear(screen.getByLabelText('Delivery radius (mi)'));
    await userEvent.type(screen.getByLabelText('Delivery radius (mi)'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Profile saved')).toBeInTheDocument();
    expect(profileState.saved).toHaveLength(1);
    expect(profileState.saved[0]).toMatchObject({
      priceRange: null,
      deliveryRadiusMiles: 5,
      address: { city: 'Austin', country: 'US' },
    });
  });

  test('client validation shows field errors and does not call the API', async () => {
    renderProfile();
    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.clear(screen.getByLabelText('Delivery radius (mi)'));
    await userEvent.type(screen.getByLabelText('Delivery radius (mi)'), '120');
    await userEvent.clear(screen.getByLabelText('Website'));
    await userEvent.type(screen.getByLabelText('Website'), 'not a url');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Use 0 to 100 miles')).toBeInTheDocument();
    expect(screen.getByText('This field is required')).toBeInTheDocument();
    expect(screen.getByText(/Enter a full web address/)).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(profileState.saved).toHaveLength(0);
  });

  test('API field errors and an address that cannot be found appear inline', async () => {
    renderProfile();
    await screen.findByLabelText('Name');
    profileState.saveError = {
      status: 400,
      code: 'VALIDATION_ERROR',
      fields: { 'address.city': 'City is not valid' },
    };
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('City is not valid')).toBeInTheDocument();

    profileState.saveError = { status: 422, code: 'ADDRESS_NOT_FOUND' };
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/We couldn't find that address/)).toBeInTheDocument();
  });

  test('a load failure shows an error state with Try again', async () => {
    server.use(http.get('*/api/profile', () => new HttpResponse(null, { status: 500 })));
    renderProfile();
    expect(
      await screen.findByText('We could not load your profile. Try again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  test('links to the welcome chat', async () => {
    renderProfile();
    await userEvent.click(await screen.findByRole('link', { name: 'Open the chat' }));
    expect(await screen.findByText('Chat page')).toBeInTheDocument();
  });
});

describe('FR-15: Products', () => {
  test('adding a Product puts it in the list', async () => {
    renderProfile();
    await userEvent.click(await screen.findByRole('button', { name: 'Add product' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add product' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Powdered sugar, 25 lb');
    await userEvent.type(within(dialog).getByLabelText('Description'), '10X');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save product' }));

    const table = await screen.findByRole('table', { name: 'Products' });
    expect(await within(table).findByText('Powdered sugar, 25 lb')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(profileState.profile.products).toHaveLength(2);
  });

  test('a Product needs a name', async () => {
    renderProfile();
    await userEvent.click(await screen.findByRole('button', { name: 'Add product' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save product' }));
    expect(await within(dialog).findByText('This field is required')).toBeInTheDocument();
  });

  test('editing a Product renames it', async () => {
    renderProfile();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Cane sugar, 50 lb' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit product' });
    const name = within(dialog).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Raw cane sugar');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save product' }));
    expect(await screen.findByText('Raw cane sugar')).toBeInTheDocument();
  });

  test('deleting asks first and removes the Product', async () => {
    renderProfile();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Cane sugar, 50 lb' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Cane sugar, 50 lb?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('No products yet')).toBeInTheDocument();
  });

  test('a Product used by a Plan cannot be deleted: PRODUCT_IN_USE', async () => {
    profileState.inUse.add(ids.product);
    renderProfile();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Cane sugar, 50 lb' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Remove it from your plans first',
    );
    expect(screen.getByRole('table', { name: 'Products' })).toHaveTextContent('Cane sugar, 50 lb');
  });
});
