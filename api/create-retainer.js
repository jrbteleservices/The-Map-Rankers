import Stripe from 'stripe';
export default async function handler(req,res){
  const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
  const session=await stripe.checkout.sessions.create({
    payment_method_types:['card'],
    line_items:[{price_data:{currency:'usd',product_data:{name:'Map Rankers Retainer $97/mo'},recurring:{interval:'month'},unit_amount:9700},quantity:1}],
    mode:'subscription',
    success_url:`https://${req.headers.host}/thank-you-497.html?retainer=1`,
    cancel_url:`https://${req.headers.host}/thank-you-497.html`,
  });
  return res.status(200).json({url:session.url});
}