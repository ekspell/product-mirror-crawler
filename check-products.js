require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function run() {
  // Check existing products
  const { data: products, error } = await supabase
    .from('products')
    .select('*');

  if (error) {
    console.error('Error fetching products:', error);
    return;
  }

  console.log('Existing products:');
  console.log(products);

  // If no Calendly product exists, create it
  if (!products || !products.find(p => p.name === 'Calendly')) {
    console.log('\nCreating Calendly product...');
    const { data: newProduct, error: insertError } = await supabase
      .from('products')
      .insert({
        name: 'Calendly',
        url: 'https://calendly.com'
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating product:', insertError);
    } else {
      console.log('Created Calendly product:', newProduct);
    }
  }
}

run().catch(console.error);
