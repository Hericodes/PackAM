import { db } from "../../../lib/db";
import { AdminCategories } from "../../../components/admin/AdminCategories";
export default async function AdminCategoriesPage(){const categories=await db.category.findMany({orderBy:{name:"asc"},take:200,select:{id:true,name:true,slug:true,description:true,isActive:true,_count:{select:{products:true}}}});return <main className="min-h-screen bg-[#f7f5ee]"><div className="packam-container py-8"><h1 className="text-3xl font-black">Categories</h1><AdminCategories categories={categories}/></div></main>;}
