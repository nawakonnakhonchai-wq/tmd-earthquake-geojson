import requests
import re
import json
import pandas as pd
from bs4 import BeautifulSoup

def fetch_tmd_earthquake():
    """
    ดึงข้อมูลรายงานแผ่นดินไหวล่าสุดจากกรมอุตุนิยมวิทยา
    สกัดพิกัดภูมิศาสตร์ และแปลงเป็นมาตรฐาน GeoJSON ผ่านระบบที่เสถียรที่สุดสำหรับ GitHub Actions
    """
    rss_url = "https://earthquake.tmd.go.th/feed/rss_tmd.xml"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    try:
        # 1. ส่งคำขอดึงข้อมูล XML จาก Server
        response = requests.get(rss_url, headers=headers, timeout=30)
        if response.status_code != 200:
            print(f"[-] ไม่สามารถเชื่อมต่อ RSS Feed ได้ รหัสข้อผิดพลาด: {response.status_code}")
            return
            
        xml_data = response.content
        soup = BeautifulSoup(xml_data, features="xml")
        items_list = soup.find_all('item')
        
        parsed_records = []
        
        # 2. วนลูปอ่านข้อมูลและสกัดค่าพิกัด
        for item in items_list:
            try:
                lat, lon = None, None
                
                # แผน ก: ตรวจสอบแท็กพิกัดตรงๆ
                lat_tag = item.find('geo:lat') or item.find('lat')
                lon_tag = item.find('geo:long') or item.find('long')
                
                if lat_tag and lon_tag:
                    lat = float(lat_tag.text.strip())
                    lon = float(lon_tag.text.strip())
                
                # แผน ข (Fallback): สกัดพิกัดจากข้อความในแท็ก <description> (CDATA) ด้วย Regex
                if lat is None or lon is None:
                    desc_tag = item.find('description')
                    if desc_tag:
                        desc_text = desc_tag.text
                        lat_match = re.search(r'Lat\.\s*([+-]?\d+\.\d+)', desc_text, re.IGNORECASE)
                        lon_match = re.search(r'Long\.\s*([+-]?\d+\.\d+)', desc_text, re.IGNORECASE)
                        if lat_match and lon_match:
                            lat = float(lat_match.group(1))
                            lon = float(lon_match.group(1))
                            
                # หากพบพิกัดภูมิศาสตร์ที่สมบูรณ์ ให้
