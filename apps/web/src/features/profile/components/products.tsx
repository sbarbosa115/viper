import { productInput, type Product } from '@app/contracts/profile';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError } from '../../../shared/api/client';
import { Banner, Button, Card, Dialog, Field, Input, Table, type Column } from '../../../shared/ui';
import { useDeleteProduct, useSaveProduct } from '../api/hooks';
import { copy, fill } from '../copy';

interface ProductValues {
  name: string;
  description: string;
}

function ProductDialog({ editing, onClose }: { editing: Product | null; onClose: () => void }) {
  const save = useSaveProduct();
  const { register, handleSubmit, setError, formState } = useForm<ProductValues>({
    defaultValues: { name: editing?.name ?? '', description: editing?.description ?? '' },
    resolver: zodResolver(productInput) as never,
  });
  const submit = handleSubmit((values) => {
    save.mutate(
      { id: editing?.id ?? null, input: values },
      {
        onSuccess: onClose,
        onError: (error) => {
          const fields = error instanceof ApiError ? error.fields : undefined;
          for (const [path, text] of Object.entries(fields ?? {})) {
            if (path === 'name' || path === 'description') setError(path, { message: text });
          }
        },
      },
    );
  });
  const { errors } = formState;
  const generic = save.isError && !(save.error instanceof ApiError && save.error.fields);
  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? copy.editProduct : copy.addProduct}
      footer={
        <>
          <Button onClick={onClose}>{copy.cancel}</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => void submit()}>
            {copy.saveProduct}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
        {generic && <Banner tone="warn">{copy.productFailed}</Banner>}
        <Field
          label={copy.productName}
          error={
            errors.name && (errors.name.type === 'too_small' ? copy.required : errors.name.message)
          }
        >
          {(props) => <Input {...props} {...register('name')} />}
        </Field>
        <Field label={copy.productDescription} error={errors.description?.message}>
          {(props) => <Input {...props} {...register('description')} />}
        </Field>
      </form>
    </Dialog>
  );
}

function DeleteDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const remove = useDeleteProduct();
  const inUse = remove.error instanceof ApiError && remove.error.code === 'PRODUCT_IN_USE';
  return (
    <Dialog
      open
      onClose={onClose}
      title={fill(copy.deleteTitle, { name: product.name })}
      footer={
        <>
          <Button onClick={onClose}>{copy.cancel}</Button>
          <Button
            variant="danger-text"
            loading={remove.isPending}
            onClick={() => remove.mutate(product.id, { onSuccess: onClose })}
          >
            {copy.delete}
          </Button>
        </>
      }
    >
      <p className="m-0">{copy.deleteBody}</p>
      {inUse && (
        <p role="alert" className="mb-0 mt-3 text-danger">
          {copy.inUse}
        </p>
      )}
      {remove.isError && !inUse && (
        <p role="alert" className="mb-0 mt-3 text-danger">
          {copy.productFailed}
        </p>
      )}
    </Dialog>
  );
}

/** FR-15: the Product list with add, edit and delete. */
export function Products({ products }: { products: Product[] }) {
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);

  const columns: Column<Product>[] = [
    {
      key: 'name',
      header: copy.productName,
      cell: (p) => <span className="text-fg">{p.name}</span>,
    },
    { key: 'description', header: copy.productDescription, cell: (p) => p.description },
    {
      key: 'actions',
      header: '',
      cell: (p) => (
        <span className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${copy.edit} ${p.name}`}
            onClick={() => setEditing(p)}
          >
            {copy.edit}
          </Button>
          <Button
            size="sm"
            variant="danger-text"
            aria-label={`${copy.delete} ${p.name}`}
            onClick={() => setDeleting(p)}
          >
            {copy.delete}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-base font-semibold text-fg">{copy.products}</h2>
        <Button onClick={() => setEditing('new')}>{copy.addProduct}</Button>
      </div>
      <Table
        caption={copy.products}
        columns={columns}
        rows={products}
        rowKey={(p) => p.id}
        emptyTitle={copy.noProducts}
        emptyDescription={copy.noProductsHint}
      />
      {editing && (
        <ProductDialog
          key={editing === 'new' ? 'new' : editing.id}
          editing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && <DeleteDialog product={deleting} onClose={() => setDeleting(null)} />}
    </Card>
  );
}
