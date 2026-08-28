import Stripe from 'stripe';
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS') return res.status(200).end();
  const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
  const session=await stripe.checkout.sessions.create({
    payment_method_types:['card'],
    line_items:[{price_data:{currency:'usd',product_data:{name:'Map Rankers - DOMINATION $497',description:'Get to Top 3 in 7 Days - 50 citations + GMB optimization + Review system - Money back guarantee'},unit_amount:49700},quantity:1}],
    mode:'payment',
    success_url:`https://${req.headers.host}/thank-you-497.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:`https://${req.headers.host}/thank-you.html`,
  });
  return res.status(200).json({url:session.url});
}