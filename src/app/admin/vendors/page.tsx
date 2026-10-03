import { db } from "../../../lib/db";
import { AdminVendors } from "../../../components/admin/AdminVendors";

export default async function AdminVendorsPage(){
 const [vendors,products,sources]=await Promise.all([db.vendor.findMany({orderBy:{name:"asc"},take:100,select:{id:true,name:true,type:true,location:true,phone:true,status:true,reliabilityScore:true,notes:true,sources:{orderBy:{updatedAt:"desc"},take:30,select:{id:true,productId:true,vendorId:true,currentPrice:true,availability:true,product:{select:{name:true}},vendor:{select:{name:true}}}}}}),db.product.findMany({where:{status:"ACTIVE"},orderBy:{name:"asc"},take:100,select:{id:true,name:true}}),db.productSource.findMany({orderBy:{updatedAt:"desc"},take:100,select:{id:true,productId:true,vendorId:true,currentPrice:true,availability:true,product:{select:{name:true}},vendor:{select:{name:true}}}})]);
 return <main className="min-h-screen bg-[#f7f5ee]"><div className="packam-container py-8"><h1 className="text-3xl font-black">Vendors &amp; sources</h1><AdminVendors vendors={vendors} products={products} sources={sources}/></div></main>;
}
