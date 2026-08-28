import Stripe from 'stripe';
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  try{
    const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
    const {businessName,location,service}=req.body||{};
    const country=req.headers['x-vercel-ip-country']||'US';
    const isIndia=country==='IN';
    // Dynamic pricing - 96% profit
    const price = isIndia? 29900 : 999; // 999 = $9.99
    const currency = isIndia? 'inr' : 'usd';

    const session=await stripe.checkout.sessions.create({
      payment_method_types:['card'],
      line_items:[{
        price_data:{
          currency:currency,
          product_data:{
            name:'The Map Rankers - Full 9-Grid Live Scan',
            description:`Real Google rank for ${businessName} in ${location} + 3 competitors analysis`
          },
          unit_amount: price,
        },
        quantity:1
      }],
      mode:'payment',
      success_url:`https://${req.headers.host}/thank-you.html?session_id={CHECKOUT_SESSION_ID}&tier=scan`,
      cancel_url:`https://${req.headers.host}/#scan`,
      metadata:{businessName,location,service:service||'',tier:'detailed_scan',google_cost:'0.34'}
    });
    return res.status(200).json({success:true,url:session.url,sessionId:session.id,displayPrice:isIndia?'₹299':'$9.99'});
  }catch(e){return res.status(500).json({error:e.message});}
}