require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function run() {
  console.log('Deleting all components...\n');

  // Get Calendly product
  const { data: products } = await supabase
    .from('products')
    .select('id, name')
    .eq('name', 'Calendly')
    .limit(1);

  if (!products || products.length === 0) {
    console.log('Calendly product not found');
    return;
  }

  const product = products[0];
  console.log(`Product: ${product.name} (${product.id})\n`);

  // Get all components for this product
  const { data: components, error: fetchError } = await supabase
    .from('components')
    .select('id, name')
    .eq('product_id', product.id);

  if (fetchError) {
    console.error('Error fetching components:', fetchError);
    return;
  }

  console.log(`Found ${components?.length || 0} components to delete\n`);

  if (!components || components.length === 0) {
    console.log('No components to delete');
    return;
  }

  // Delete component instances first (due to foreign key constraints)
  const componentIds = components.map(c => c.id);
  const { error: instanceDeleteError } = await supabase
    .from('component_instances')
    .delete()
    .in('component_id', componentIds);

  if (instanceDeleteError) {
    console.error('Error deleting component instances:', instanceDeleteError);
    return;
  }

  console.log('✓ Deleted component instances');

  // Delete components
  const { error: componentDeleteError } = await supabase
    .from('components')
    .delete()
    .eq('product_id', product.id);

  if (componentDeleteError) {
    console.error('Error deleting components:', componentDeleteError);
    return;
  }

  console.log('✓ Deleted components');
  console.log(`\n✓ Done! Deleted ${components.length} components and their instances`);
}

run().catch(console.error);
