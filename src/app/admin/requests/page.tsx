import { ProductRequestStatus } from "@prisma/client";
import { db } from "../../../lib/db";
import { AdminRequests } from "../../../components/admin/AdminRequests";

export default async function AdminRequestsPage({searchParams}:{searchParams:Promise<{status?:string}>}){
 const params=await searchParams;const valid=Object.values(ProductRequestStatus).includes(params.status as ProductRequestStatus);const status=valid?params.status as ProductRequestStatus:undefined;
 const [requests,products]=await Promise.all([db.productRequest.findMany({where:status?{status}:{status:{in:["PENDING","CHECKING"]}},orderBy:{createdAt:"asc"},take:100,select:{id:true,requestedName:true,quantity:true,variant:true,description:true,status:true,createdAt:true,user:{select:{firstName:true,lastName:true,email:true}},product:{select:{id:true,name:true}}}}),db.product.findMany({where:{status:"ACTIVE"},orderBy:{name:"asc"},take:100,select:{id:true,name:true}})]);
 return <main className="min-h-screen bg-[#f7f5ee]"><div className="packam-container py-8"><div className="flex flex-wrap justify-between gap-3"><h1 className="text-3xl font-black">Product requests</h1><nav className="flex flex-wrap gap-2">{["PENDING","CHECKING","AVAILABLE","UNAVAILABLE","CANCELLED"].map(s=><a key={s} href={`/admin/requests?status=${s}`} className={`rounded-full px-3 py-2 text-xs font-bold ${status===s?"bg-[#feb80a]":"bg-white"}`}>{s}</a>)}</nav></div><AdminRequests requests={requests} products={products}/></div></main>;
}
